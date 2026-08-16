import { randomUUID } from "node:crypto";
import { createAgent } from "./agent";
import { createRegistry, fire } from "./extension-api";
import { loadExtensions } from "./extensions";
import { loadAgentRules } from "./guidance";
import { currentModel } from "./models";
import { errorText, flatten } from "./render";
import { loadSkills } from "./skills";
import { runShell, type ToolEvent } from "./tools";

// Headless. One turn, no TUI, no session file, and nobody to ask — so ask_user
// is withheld rather than left to hang on an answer that cannot arrive.
//
// Assistant text goes to stdout and the tool trail to stderr, so a redirect
// keeps the answer clean and `2>&1` puts the trail back in order. That split is
// what makes this composable: it is how the agent verifies its own changes, how
// anything scripts glorious, and how one glorious spawns another through bash
// with every step of the child visible in the parent's output.

const TRAIL_CHARS = 100;

export const runPrint = async (
  prompt: string,
  where: { root: string; os: string; git: string },
): Promise<number> => {
  const model = currentModel();
  const [rules, skills] = await Promise.all([loadAgentRules(where.root), loadSkills(where.root)]);

  // Extensions load here too. They have to: a tool the agent writes for itself
  // has to exist when it verifies with -p, or self-extension is a claim nothing
  // can check. What has no meaning in a one-shot run is refused out loud rather
  // than silently doing nothing.
  const registry = createRegistry();
  let toolSink: (event: ToolEvent) => void = () => {};
  const note = (message: string): void => {
    process.stderr.write(`${message}\n`);
  };
  const loaded = await loadExtensions(
    where.root,
    registry,
    {
      root: where.root,
      exec: (command, args) => runShell(where.root, command, args),
      send: () => note("[extension] send() has no meaning in print mode; ignored"),
      print: (text) => note(text),
      ask: async () => {
        throw new Error("ask() has no meaning in print mode: there is nobody to answer");
      },
    },
    (event) => toolSink(event),
  );
  for (const failure of loaded.failures) note(`[extension ${failure.origin}] ${failure.message}`);

  const agent = createAgent({
    root: where.root,
    model,
    // Fresh every run. This becomes the provider's promptCacheKey, and a
    // constant one tells the backend that unrelated runs are the same
    // conversation — after which it looks for reasoning items the previous run
    // left behind and fails the turn with "Item with id 'rs_…' not found".
    // The TUI passes its session uuid here for the same reason.
    sessionId: `print-${randomUUID().slice(0, 8)}`,
    rules,
    cwd: where.root,
    os: where.os,
    date: new Date().toISOString().slice(0, 10),
    git: where.git,
    skills: skills.catalog,
    skillTools: skills,
    askQuestions: null,
    extensionTools: (onTool) => {
      toolSink = onTool;
      return registry.tools;
    },
    extensionPrompt: () => registry.promptLines,
  });

  const stop = new AbortController();
  const onSigint = (): void => stop.abort();
  process.on("SIGINT", onSigint);

  const started = new Map<number, number>();
  let streamed = false;
  try {
    await fire(registry, "session_start", { root: where.root }, note);
    await fire(registry, "turn_start", { text: prompt }, note);
    const result = await agent.run(prompt, [], {
      signal: stop.signal,
      onDelta: ({ kind, text }) => {
        // Reasoning is the model talking to itself; in a pipe it is noise the
        // caller did not ask for.
        if (kind !== "text") return;
        streamed = true;
        process.stdout.write(text);
      },
      onTool: (event) => {
        if (event.phase === "start") {
          started.set(event.id, Date.now());
          void fire(registry, "tool_start", { name: event.name, input: event.input }, note);
          return;
        }
        const since = started.get(event.id);
        started.delete(event.id);
        const took = since === undefined ? "" : ` ${((Date.now() - since) / 1000).toFixed(1)}s`;
        const detail = flatten(event.detail).slice(0, TRAIL_CHARS);
        process.stderr.write(
          `${event.ok ? "✓" : "✗"} ${event.name}${detail && ` ${detail}`}${took}\n`,
        );
        void fire(
          registry,
          "tool_end",
          { name: event.name, input: event.input, ok: event.ok, result: event.result },
          note,
        );
      },
      onStep: () => {},
      onReasoningEnd: () => {},
      onPhase: () => {},
    });
    if (!streamed && result.text.trim() !== "") process.stdout.write(result.text);
    process.stdout.write("\n");
    await fire(registry, "turn_end", { text: result.text }, note);
    if (result.stoppedAtStepLimit) {
      process.stderr.write("[stopped at the step limit without finishing]\n");
      return 1;
    }
    return 0;
  } catch (thrown) {
    process.stderr.write(`${stop.signal.aborted ? "[interrupted]" : errorText(thrown)}\n`);
    return 1;
  } finally {
    process.off("SIGINT", onSigint);
  }
};
