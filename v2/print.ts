import { randomUUID } from "node:crypto";
import { createAgent } from "./agent";
import { createRegistry, describeContribution, fire } from "./extension-api";
import { loadExtensions } from "./extensions";
import { loadAgentRules } from "./guidance";
import { currentModel } from "./models";
import { errorText, flatten } from "./render";
import { loadSkills } from "./skills";
import { runShell, setToolGate, type ToolEvent } from "./tools";

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

  // Extensions load here too. They have to: a tool the agent writes for itself
  // has to exist when it verifies with -p, or self-extension is a claim nothing
  // can check. What has no meaning in a one-shot run is refused out loud rather
  // than silently doing nothing.
  const registry = createRegistry();
  const stop = new AbortController();
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
      print: (content) =>
        note(
          typeof content === "string"
            ? content
            : content.map((line) => line.map((span) => span.text).join("")).join("\n"),
        ),
      ask: async () => {
        throw new Error("ask() has no meaning in print mode: there is nobody to answer");
      },
      // Extensions load headlessly too, so anything they inspect has to answer.
      // A one-shot run has no command table or sequences of its own.
      inspect: () => ({
        commands: [],
        sequences: [],
        skills: skills.summaries,
        extensions: loaded.extensions.map((entry) => ({
          ...entry,
          contributed: describeContribution(registry, entry.origin),
        })),
      }),
      clear: () => "empty" as const,
      reload: async () => note("[extension] reload() has no meaning in print mode; ignored"),
      // A one-shot run has no composer, no queue and no session file. These
      // refuse out loud rather than pretending: an extension that guards on
      // g.hasUI works headlessly, and one that does not finds out immediately
      // instead of silently doing nothing.
      mode: "print" as const,
      setInput: () => note("[extension] setInput() has no meaning in print mode; ignored"),
      tools: () => agent.toolNames(),
      setTools: (names: readonly string[] | null) => agent.setTools(names),
      model: () => ({
        label: `${model.provider}/${model.modelId}`,
        provider: model.provider,
        modelId: model.modelId,
        variant: model.variant,
        variants: model.variants,
        context: model.context,
      }),
      models: async () => {
        throw new Error("models() needs the catalogue; not loaded in print mode");
      },
      setModel: async () => {
        throw new Error("setModel() has no meaning in a one-shot run");
      },
      idle: () => false,
      pending: () => 0,
      abort: () => {
        stop.abort();
        return true;
      },
      usage: () => ({ tokens: null, context: model.context }),
      systemPrompt: () => agent.prompt(),
      shutdown: () => stop.abort(),
      session: () => ({ id: "print", file: "", title: "print", events: 0 }),
      setSessionName: () => {},
      appendEntry: () => {},
    },
    (event) => toolSink(event),
  );
  for (const failure of loaded.failures) note(`[extension ${failure.origin}] ${failure.message}`);

  const onSigint = (): void => stop.abort();
  process.on("SIGINT", onSigint);

  const started = new Map<number, number>();
  let streamed = false;
  try {
    // A tool_call handler returning false refuses the call; the model is told so
    // by name, which is what lets an extension implement a read-only mode or a
    // confirmation gate without the core knowing either exists.
    setToolGate({
      before: async (name, input) => {
        const verdict = await fire(registry, "tool_call", { name, input }, note);
        if (verdict === false) return `ERROR: an extension blocked ${name} for this turn.`;
        return typeof verdict === "string" ? `ERROR: ${verdict}` : undefined;
      },
      after: async (name, input, ok, result) => {
        const replaced = await fire(registry, "tool_end", { name, input, ok, result }, note);
        return typeof replaced === "string" ? replaced : undefined;
      },
    });
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
