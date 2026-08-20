import { randomUUID } from "node:crypto";
import { loadAgentRules } from "../../glrs-core/src/guidance";
import { runShell } from "../../glrs-core/src/shell";
import { currentModel, envSetting, loadConfig, modelMetadata } from "../../provider-registry/src";
import { createAgent } from "./agent";
import { createRegistry, describeContribution, fire, promptContributions } from "./extension-api";
import { loadExtensions, resolveExtensions, shippedExtensions, skillRootsFor } from "./extensions";
import { expandMentions } from "./mentions";
import { advanceToolRun, errorText, NO_TOOL_RUN, toolRow } from "./render";
import { loadSkills } from "./skills";
import { firstDetail, resultSummary, setToolGate, type ToolEvent } from "./toolkit";

// Headless. One turn, no TUI, no session file, and nobody to ask — so ask_user
// is withheld rather than left to hang on an answer that cannot arrive.
//
// Assistant text goes to stdout and the tool trail to stderr, so a redirect
// keeps the answer clean and `2>&1` puts the trail back in order. That split is
// what makes this composable: it is how the agent verifies its own changes, how
// anything scripts glrs, and how one glrs spawns another through bash
// with every step of the child visible in the parent's output.

const TRAIL_CHARS = 100;

export const runPrint = async (
  prompt: string,
  where: { root: string; os: string; git: string },
): Promise<number> => {
  // Hydrated here as well as in the TUI. Without it a headless run reports
  // every cost as zero — and scripting a cost report is exactly what -p is for,
  // so the one place it must work is the one place it did not. Silent on
  // failure: offline you get tokens without prices, as in the TUI.
  const [rules, loadedConfig] = await Promise.all([
    loadAgentRules(where.root),
    loadConfig(where.root),
  ]);
  // Same as the TUI: an extension's skills/ directory joins the roots, worked
  // out from the inert plan rather than by running anything. Without this a
  // skill an extension ships would be invisible to `-p` — which is the path the
  // skills themselves tell the agent to verify its work with.
  const skills = await loadSkills(
    where.root,
    undefined,
    skillRootsFor((await resolveExtensions(where.root, loadedConfig.config.extensions)).plan),
  );
  // Built from the config, which it was not: currentModel() was called with no
  // arguments here, so a model set in .glrs/config.json worked in the TUI
  // and was ignored by every headless run — including the ones the agent uses to
  // check its own work.
  const chosen = currentModel(loadedConfig.config);
  const model = {
    ...chosen,
    ...(await modelMetadata(chosen).catch(() => ({}))),
  };
  const envToolTimeout = Number(envSetting("TOOL_TIMEOUT_MS"));
  const toolTimeoutMs =
    Number.isFinite(envToolTimeout) && envToolTimeout > 0
      ? envToolTimeout
      : loadedConfig.config.tool_timeout_ms;

  const agent = createAgent({
    root: where.root,
    model,
    toolTimeoutMs,
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
    extensionTools: (onTool) => {
      toolSink = onTool;
      return registry.tools;
    },
    extensionPrompt: () => promptContributions(registry.promptLines),
    onContext: async (messages, step) => {
      const said = await fire(registry, "context", { messages, step }, note);
      return Array.isArray(said) ? said : undefined;
    },
    onRequest: async (request) => {
      const said = await fire(registry, "before_provider_request", request, note);
      return said && typeof said === "object" && !Array.isArray(said) ? said : undefined;
    },
    onResponse: (response) => {
      void fire(registry, "after_provider_response", response, note);
    },
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
      settings: () => ({ tool_timeout_ms: toolTimeoutMs }),
      available: () => shippedExtensions(loadedConfig.config.extensions),
      // A headless run is one turn with no one to answer, so there is nobody to
      // agree to anything and nothing to record.
      setExtension: async () => {
        note("[extension] setExtension() has no meaning in print mode; ignored");
        return "not-allowed" as const;
      },
      send: () => note("[extension] send() has no meaning in print mode; ignored"),
      print: (content) =>
        note(
          typeof content === "string"
            ? content
            : content.map((line) => line.map((span) => span.text).join("")).join("\n"),
        ),
      columns: () => Number(process.env.COLUMNS ?? 100),
      capture: () => {
        throw new Error("ui.capture() has no meaning in print mode: there is no composer");
      },
      // Extensions load headlessly too, so anything they inspect has to answer.
      // A one-shot run has no command table of its own.
      inspect: () => ({
        commands: [],
        skills: skills.summaries,
        extensions: loaded.extensions.map((entry) => ({
          ...entry,
          contributed: describeContribution(registry, entry.origin),
        })),
        // Registered headlessly and never dispatched — but an extension asking
        // what exists should get the truth, not an empty list.
        keys: registry.keys.map(({ key, ctrl, shift, description }) => ({
          key,
          ctrl,
          shift,
          description,
        })),
        flags: [...registry.flags].map(([name, spec]) => ({
          name,
          description: spec.description,
        })),
      }),
      clear: () => "empty" as const,
      compact: async () => ({ outcome: "too-short" as const }),
      reload: async () => note("[extension] reload() has no meaning in print mode; ignored"),
      // A one-shot run has no composer, no queue and no session file. These
      // refuse out loud rather than pretending: an extension that guards on
      // g.hasUI works headlessly, and one that does not finds out immediately
      // instead of silently doing nothing.
      mode: "print" as const,
      setInput: () => note("[extension] setInput() has no meaning in print mode; ignored"),
      tools: () => agent.toolNames(),
      setToolFilters: (filters) => agent.setToolFilters(filters),
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
      usage: () => ({
        tokens: seenTokens,
        context: model.context,
        last: lastUsage,
        total: totals,
      }),
      systemPrompt: () => agent.prompt(),
      shutdown: () => stop.abort(),
      session: () => ({ id: "print", file: "", title: "print", events: 0 }),
      setSessionName: () => {},
      appendEntry: () => {},
      // A one-shot run has no session file, so nothing was ever written and
      // there is nothing to read.
      entries: () => [],
    },
    (event) => toolSink(event),
    { settings: loadedConfig.config.extensions },
  );
  for (const failure of loaded.failures) note(`[extension ${failure.origin}] ${failure.message}`);
  for (const said of loaded.notes) note(`[extension] ${said}`);
  for (const warning of skills.warnings) note(`[skill] ${warning}`);
  for (const problem of loadedConfig.diagnostics) note(`[config] ${problem}`);
  const banned = new Set(
    (loadedConfig.config.tools?.disable ?? []).map((name) => name.trim().toLowerCase()),
  );
  if (banned.size > 0) agent.setToolFilters([(name) => !banned.has(name.toLowerCase())]);

  const onSigint = (): void => stop.abort();
  process.on("SIGINT", onSigint);

  const started = new Map<number, number>();
  let run = NO_TOOL_RUN;
  const closeRun = (): void => {
    const stepped = advanceToolRun(run, { type: "assistant", text: "" });
    run = stepped.run;
    for (const line of stepped.footer) note(line.map((span) => span.text).join(""));
  };
  let streamed = false;
  let seenTokens: number | null = null;
  let lastUsage: { input: number; output: number; cached: number; cost?: number } | undefined;
  // A one-shot run has no session file to sum, so the totals are kept here.
  const totals = { input: 0, output: 0, cached: 0, cost: 0, steps: 0 };
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
      after: async (name, input, ok, result, elapsedMs) => {
        const replaced = await fire(
          registry,
          "tool_end",
          { name, input, ok, result, detail: firstDetail(input), elapsedMs },
          note,
        );
        return typeof replaced === "string" ? replaced : undefined;
      },
    });
    await fire(registry, "session_start", { root: where.root }, note);
    await fire(registry, "turn_start", { text: prompt }, note);
    const { prompt: asked, missing } = await expandMentions(where.root, prompt);
    for (const path of missing) note(`(no such file: @${path} — sent as text)`);
    // The same hook the TUI fires before a request. It was wired through
    // createChat, which print mode does not use, so every context-injecting
    // extension worked interactively and silently did nothing here — including
    // in the runs the agent uses to check its own work.
    const added = await fire(registry, "before_request", { prompt: asked, messages: 0 }, note);
    const sent = typeof added === "string" && added !== "" ? `${asked}\n\n${added}` : asked;
    const result = await agent.run(sent, [], {
      signal: stop.signal,
      onDelta: ({ kind, text }) => {
        // Reasoning is the model talking to itself; in a pipe it is noise the
        // caller did not ask for.
        void fire(registry, "message", { kind, text }, note);
        if (kind !== "text") return;
        // The model speaking closes the run of calls before it, exactly as it
        // does on screen — same rule, same function, so `2>&1` and a watched
        // session describe the same turn the same way.
        closeRun();
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
        // The row the TUI draws, flattened to text. This used to be a second
        // copy of the same layout written out by hand, so the two could — and
        // did — drift apart: a piped trail and a watched session are the same
        // call and have to read the same way.
        const rows = toolRow(
          event.name,
          event.detail,
          since === undefined ? 0 : Date.now() - since,
          event.ok,
          undefined,
          event.result,
          TRAIL_CHARS,
          resultSummary(event.name, event.result, event.ok),
        );
        const text = rows
          .map((line) => line.map((span) => span.text).join(""))
          .join("\n")
          .trimEnd();
        process.stderr.write(`${text}\n`);
        run = advanceToolRun(run, {
          type: "tool",
          name: event.name,
          detail: event.detail,
          elapsedMs: since === undefined ? 0 : Date.now() - since,
          ok: event.ok,
          input: event.input,
          result: event.result,
        }).run;
      },
      // Print mode discarded usage entirely, so an extension running headlessly
      // could see none of it. It reports the same figures the TUI does.
      onStep: (step) => {
        seenTokens = step.contextTokens;
        lastUsage = {
          input: step.contextTokens,
          output: step.outputTokens,
          cached: step.cachedTokens,
          cost: step.cost,
        };
        totals.input += step.contextTokens;
        totals.output += step.outputTokens;
        totals.cached += step.cachedTokens;
        totals.cost += step.cost ?? 0;
        totals.steps += 1;
        void fire(registry, "usage", { ...lastUsage, contextTokens: step.contextTokens }, note);
      },
      onReasoningEnd: ({ text, elapsedMs }) => {
        // Not printed — reasoning is noise in a pipe — but announced, so an
        // extension that records or measures it works headlessly too.
        void fire(registry, "reasoning", { text, elapsedMs }, note);
      },
      onPhase: () => {},
      onRetry: (attempt, why) => note(`[retry ${attempt + 1}] connection dropped: ${why}`),
    });
    // A turn that ends on a tool call still closes its run, or the last thing
    // the agent did would be the one thing with no receipt.
    closeRun();
    if (!streamed && result.text.trim() !== "") process.stdout.write(result.text);
    process.stdout.write("\n");
    await fire(registry, "turn_end", { text: result.text }, note);
    // The queue is empty and nothing is running: the same thing "idle" means in
    // the TUI. An extension that reports totals when a turn settles has to fire
    // here too, or it works interactively and silently does nothing headlessly.
    await fire(registry, "idle", {}, note);
    if (result.stoppedAtStepLimit) {
      process.stderr.write("[stopped at the step limit without finishing]\n");
      return 1;
    }
    return 0;
  } catch (thrown) {
    const message = stop.signal.aborted ? "[interrupted]" : errorText(thrown);
    // Announced, not just printed. An extension that reports failures — to a
    // log, a webhook, an exit code of its own — worked interactively and saw
    // nothing here.
    await fire(registry, "error", { message }, note);
    process.stderr.write(`${message}\n`);
    return 1;
  } finally {
    // A one-shot run ends too, and an extension with something to flush has to
    // be told. session_start fired without a matching session_end.
    await fire(registry, "session_end", { root: where.root }, note);
    process.off("SIGINT", onSigint);
  }
};
