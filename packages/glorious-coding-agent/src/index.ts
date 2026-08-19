import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import packageJson from "../../../package.json";
import { messagesOf, type SessionEvent, usageTotals } from "../../glorious-core/src/events";
import {
  createSession,
  loadPromptHistory,
  openSession,
  savePromptHistory,
  saveSession,
  sessionFile,
} from "../../glorious-core/src/session";
import {
  currentModel,
  loadCatalogue,
  loadConfig,
  missingFor,
  modelLabel,
  modelMetadata,
  modelRef,
  providerSpec,
} from "../../provider-registry/src";
import { createAgent } from "./agent";
import { type ChatPhase, type ChatSignal, createChat } from "./chat";
import { commandByName, commands, expandCommand, setCustomCommands } from "./commands";
import {
  createRegistry,
  describeContribution,
  type ExtensionHost,
  fire,
  resetRegistry,
} from "./extension-api";
import { loadExtensions } from "./extensions";
import { loadAgentRules } from "./guidance";
import { expandMentions, fileCandidates } from "./mentions";
import { runPrint } from "./print";
import { fence } from "./prompt";
import {
  advanceToolRun,
  assistantBlock,
  errorText,
  eventBlock,
  heldRow,
  type Line,
  NO_TOOL_RUN,
  noticeBlock,
  queuedRow,
  reasoningDraft,
  runningRow,
  statusLine,
  statusRow,
  userBlock,
} from "./render";
import { loadSkills } from "./skills";
import { firstDetail, runShell, setToolGate, type ToolEvent } from "./tools";
import { createScreen, pickSession } from "./ui";
import { loadUserCommands } from "./usercommands";

const TICK_MS = 100;
const SETTLE_MS = 250;
const PACKAGE_NAME = "@glrs-dev/glorious";
const VERSION = packageJson.version;

const probe = () => {
  const cwd = process.cwd();
  const [top, os, branch, changes] = [
    ["git", "rev-parse", "--show-toplevel"],
    ["uname", "-sr"],
    ["git", "branch", "--show-current"],
    ["git", "status", "--porcelain"],
  ].map(([bin, ...argv]) => {
    try {
      return execFileSync(bin, argv, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      return "";
    }
  });
  const dirty = changes === "" ? 0 : changes.split("\n").length;
  const home = homedir();
  const root = top === "" ? cwd : top;
  return {
    root,
    os,
    branch: branch === "" ? "HEAD" : branch,
    worktree: root === cwd ? null : cwd.slice(`${root}/`.length),
    git: `${branch === "" ? "HEAD" : branch} ${dirty === 0 ? "clean" : `${dirty} files changed`}`,
    label: root === home || root.startsWith(`${home}/`) ? `~${root.slice(home.length)}` : root,
  };
};

const USAGE =
  "Usage: glorious [--version | update | doctor [--json] | --resume [session-id] | " +
  "--model <provider/model> | -p <prompt>]";

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--version") {
    process.stdout.write(`glorious ${VERSION}\n`);
    return;
  }
  if (args.length === 1 && args[0] === "update") {
    execFileSync("bun", ["add", "-g", `${PACKAGE_NAME}@next`], { stdio: "inherit" });
    return;
  }
  // Applied before anything reads the model, so it wins the same way the
  // environment variable does — and so -p and the TUI take it alike.
  const chosenModel = args[args.indexOf("--model") + 1];
  if (args.includes("--model") && chosenModel !== undefined)
    process.env.GLORIOUS_MODEL = chosenModel;

  // Headless, and handled before anything opens the terminal: the whole point
  // is that this path never touches the alternate screen.
  const printAt = args.findIndex((arg) => arg === "-p" || arg === "--print");
  if (printAt >= 0) {
    // Piped input joins the prompt rather than replacing it, so both
    // `cat log | glorious -p "what failed?"` and a bare `cat log | glorious -p`
    // work. Fenced, so a diff or a log reads as material rather than as further
    // instructions — the same treatment piped input gets.
    const piped = process.stdin.isTTY ? "" : (await Bun.stdin.text()).trim();
    const asked = args
      .slice(printAt + 1)
      .join(" ")
      .trim();
    const prompt = [asked, piped === "" ? "" : fence("input", piped)]
      .filter((part) => part !== "")
      .join("\n\n");
    if (prompt === "") throw new Error("Nothing to run: -p needs a prompt or piped input.");
    const { root, os, git } = probe();
    process.exitCode = await runPrint(prompt, { root, os, git });
    return;
  }
  let resumeId: string | undefined;
  // Found wherever it sits: flags may precede it now, and `--model x doctor`
  // silently opening the TUI instead of reporting was worse than an error.
  const doctor = args.includes("doctor");
  const doctorJson = doctor && args.includes("--json");
  // A bare word is only ever a flag's value. Anything else is a typo, and
  // saying so beats opening a session that ignores what was asked for.
  if (!doctor)
    args.forEach((arg, at) => {
      if (arg.startsWith("-")) return;
      if (!args[at - 1]?.startsWith("-")) throw new Error(USAGE);
    });
  if (args.includes("--resume")) resumeId = args[args.indexOf("--resume") + 1];
  // An extension registers its flags while loading, which is long after argv is
  // parsed — so unrecognised `--name value` pairs are carried here and handed
  // over once the extensions that claim them exist. One glorious does not
  // recognise is reported rather than ignored.
  const extraFlags = new Map<string, string>();
  for (let at = 0; at < args.length; at += 1) {
    const flag = /^--([a-z][a-z0-9-]*)$/u.exec(args[at]);
    if (flag && !["resume", "version", "print", "model"].includes(flag[1])) {
      extraFlags.set(flag[1], args[at + 1] ?? "");
      at += 1;
    }
  }
  const { root, os, branch, worktree, git, label } = probe();
  const resolvedConfig = await loadConfig(root);
  if (doctor) {
    const chosen = currentModel(resolvedConfig.config);
    const report = {
      diagnostics: resolvedConfig.diagnostics,
      model: chosen,
      provider: providerSpec(chosen.provider)?.label ?? `${chosen.provider} (OpenAI-compatible)`,
      missing: missingFor(chosen.provider, resolvedConfig.config.providers?.[chosen.provider]),
    };
    if (doctorJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      const lines = [
        `model: ${modelLabel(report.model)}`,
        `provider: ${report.provider}`,
        ...(report.missing.length === 0
          ? ["credentials: found"]
          : report.missing.map((gap) => `missing: ${gap}`)),
        ...report.diagnostics,
      ];
      process.stdout.write(`${lines.join("\n")}\n`);
    }
    return;
  }
  // Only --resume resumes. This keyed on `args.length === 0`, so once
  // extensions could add flags, `glorious --anything` silently opened the
  // session picker instead of starting a session.
  const resuming = args.includes("--resume");
  const session = resuming ? await openSession(resumeId, pickSession) : await createSession(root);
  const promptHistory = await loadPromptHistory();
  const rules = await loadAgentRules(root);
  const config = resolvedConfig;
  let model = currentModel(config.config);
  const envToolTimeout = Number(process.env.GLORIOUS_TOOL_TIMEOUT_MS);
  const toolTimeoutMs =
    Number.isFinite(envToolTimeout) && envToolTimeout > 0
      ? envToolTimeout
      : config.config.tool_timeout_ms;
  let skills = await loadSkills(root);
  // Slash commands come from two places: markdown files in a commands
  // directory, and skills, which answer under a `skill:` prefix of their own.
  let userCommands = await loadUserCommands(root);
  // Extensions register commands as they load, so they are merged in here
  // rather than pushed separately — one table, one collision rule.
  const registry = createRegistry();
  const registerCommands = (): void =>
    setCustomCommands([...registry.commands, ...skills.commands, ...userCommands]);
  registerCommands();
  const resumedUsage = session.events.findLast((event) => event.type === "usage");
  let tokens =
    session.contextTokens ?? (resumedUsage?.type === "usage" ? resumedUsage.tokens : null);
  let produced = false;
  // The run of tool calls currently open, for the receipt that closes it.
  let group = NO_TOOL_RUN;
  // the last thing the model said, so turn_end can hand it to an extension
  let lastAnswer = "";
  // the most recent model call's figures, for g.usage()
  let lastUsage: { input: number; output: number; cached: number; cost?: number } | undefined;
  // Where an extension tool's events go. Extension tools are built once at
  // load, but the handler that pairs start with end belongs to whichever turn
  // is running, so the agent points this at the live one each turn.
  let toolSink: (event: ToolEvent) => void = () => {};
  // what the current draft block is showing, so deltas append rather than replace
  let live: { kind: "text" | "reasoning"; text: string } = { kind: "text", text: "" };
  // what the model call is doing, and since when — the wave shows both
  let phase: ChatPhase = null;
  let phaseSince = Date.now();
  const running: Array<{
    id: number;
    name: string;
    detail: string;
    input: Record<string, unknown>;
    since: number;
  }> = [];

  // A renderer is third-party code running on every frame. One that throws
  // would otherwise take the paint loop down 11 times a second, so it loses its
  // contribution for that frame and nothing else.
  const safely = <T>(render: () => T): T | undefined => {
    try {
      return render();
    } catch {
      return undefined;
    }
  };

  const renderCall = (name: string, input: Record<string, unknown>): Line[] | undefined =>
    registry.renderers.get(name)?.call?.(input);

  const renderTool = (
    name: string,
    input: Record<string, unknown>,
    result: string,
    ok: boolean,
  ): Line[] | undefined => {
    const renderer = registry.renderers.get(name);
    if (!renderer) return undefined;
    return safely(() => renderer.result?.(result, ok) ?? renderer.call?.(input));
  };

  const repaint = (): void => {
    // one paint per frame for however many deltas landed since the last one
    chat.flush();
    const now = Date.now();
    const progress: Line[] = [];
    for (const tool of running) {
      if (now - tool.since < SETTLE_MS) continue;
      progress.push(
        ...runningRow(
          tool.name,
          tool.detail,
          safely(() => renderCall(tool.name, tool.input)),
          screen.columnsNow(),
        ),
      );
    }
    for (const entry of chat.queued)
      progress.push(queuedRow({ kind: entry.kind, text: entry.label ?? entry.text }));
    if (chat.held) progress.push(heldRow(chat.queued.length));
    screen.setProgress(progress);
    screen.setFooter(registry.footers.flatMap((render) => safely(render) ?? []));
    // An extension gets first refusal on the activity row; the default stands
    // when none of them wants it. One that throws loses only its own turn at it.
    const activity = {
      // Compaction is a model call with nothing else on screen, so it counts as
      // busy for the row that says something is happening. Without this the one
      // operation that can run for minutes was the one that showed nothing.
      busy: chat.busy || chat.compacting,
      queued: chat.queued.length,
      columns: screen.columnsNow(),
      phase: phase === null ? null : { name: phase, ms: now - phaseSince },
    };
    const drawn =
      registry.activities.reduce<Line[] | null>(
        (carried, render) => carried ?? safely(() => render(activity)) ?? null,
        null,
      ) ?? statusRow(activity);
    screen.setStatusRow(chat.busy || chat.compacting ? drawn : []);
    screen.setStatus(
      statusLine(
        {
          model: `${modelLabel(model)}${model.variant ? ` (${model.variant})` : ""}`,
          tokens,
          percentUsed:
            model.context !== undefined && tokens !== null ? (tokens / model.context) * 100 : null,
          segments: registry.statuses
            .map((render) => safely(render))
            .filter((segment): segment is string => typeof segment === "string"),
        },
        screen.columns(),
      ),
    );
  };

  const agent = createAgent({
    root,
    model,
    toolTimeoutMs,
    sessionId: session.id,
    rules,
    cwd: root,
    os,
    date: new Date().toISOString().slice(0, 10),
    git,
    skills: skills.catalog,
    skillTools: skills,
    extensionTools: (onTool) => {
      toolSink = onTool;
      return registry.tools;
    },
    extensionPrompt: () => registry.promptLines,
    onContext: async (messages, step) => {
      const said = await fire(registry, "context", { messages, step }, onExtensionFailure);
      return Array.isArray(said) ? said : undefined;
    },
    onRequest: async (request) => {
      const said = await fire(registry, "before_provider_request", request, onExtensionFailure);
      return said && typeof said === "object" && !Array.isArray(said) ? said : undefined;
    },
    onResponse: (response) => {
      void fire(registry, "after_provider_response", response, onExtensionFailure);
    },
  });

  const record = (event: SessionEvent): void => {
    session.events.push(event);
    session.updatedAt = new Date().toISOString();
    if (event.type === "usage" || event.type === "turn") void saveSession(session);
  };

  // Display only: the transform never reaches the session or the model, so an
  // extension that rewrites assistant markdown cannot corrupt the transcript.
  const shown = (text: string): string =>
    registry.markdown.reduce(
      (carried, transform) => safely(() => transform(carried)) ?? carried,
      text,
    );

  const render = (event: SessionEvent): void => {
    record(event);
    if (event.type === "usage") {
      tokens = event.tokens;
      session.contextTokens = event.tokens;
      lastUsage = {
        input: event.input ?? 0,
        output: event.output ?? 0,
        cached: event.cached,
        cost: event.cost,
      };
      void fire(
        registry,
        "usage",
        { ...lastUsage, contextTokens: event.tokens },
        onExtensionFailure,
      );
    }
    // A steering message is something the user said *into* a turn that was
    // already running, so it is a user event that does not start a turn. Left
    // unguarded it reset `produced`, and a turn that had already run three
    // tools then reported "(no response)"; and it told every extension a new
    // turn had begun in the middle of the one they were already watching.
    if (event.type === "user" && event.steer !== true) {
      produced = false;
      void fire(registry, "turn_start", { text: event.text }, onExtensionFailure);
    }
    if (event.type === "assistant") lastAnswer = event.text;
    if (event.type === "reasoning")
      void fire(
        registry,
        "reasoning",
        { text: event.text, elapsedMs: event.elapsedMs },
        onExtensionFailure,
      );
    // Fired for a failed turn, not for an extension's own reported failure —
    // an error handler that itself throws would otherwise loop.
    if (event.type === "error" && !event.text.startsWith("(extension"))
      void fire(registry, "error", { message: event.text }, onExtensionFailure);
    if (event.type === "assistant" || event.type === "tool") produced = true;
    // A run of consecutive calls gets one receipt, printed when the run ends —
    // which is the moment the model says something, or the turn does. Nothing
    // is buffered to achieve this: each row still prints as its call lands, and
    // the footer is one more line appended after the last of them.
    const stepped = advanceToolRun(group, event);
    group = stepped.run;
    if (stepped.footer.length > 0) screen.print(stepped.footer, false);
    const { lines, gap } = eventBlock(
      event.type === "assistant" ? { ...event, text: shown(event.text) } : event,
      renderTool,
      screen.columnsNow(),
    );
    // A streamed answer is already on screen. Seal that block with its final
    // rendering rather than printing the same text a second time; the event is
    // recorded either way.
    if (event.type === "assistant" && screen.isDrafting()) {
      screen.sealDraft(lines);
      repaint();
      return;
    }
    if (lines.length > 0) {
      screen.sealDraft();
      screen.print(lines, gap);
    }
    repaint();
  };

  const react = (value: ChatSignal): void => {
    switch (value.type) {
      case "tool": {
        if (value.tool.phase === "start") {
          const { id, name, detail, input } = value.tool;
          running.push({ id, name, detail, input, since: Date.now() });
          void fire(registry, "tool_start", { name, input }, onExtensionFailure);
          break;
        }
        const slot = running.findIndex((tool) => tool.id === value.tool.id);
        if (slot >= 0) running.splice(slot, 1);
        break;
      }
      case "delta":
        void fire(registry, "message", { kind: value.kind, text: value.text }, onExtensionFailure);
        live = value.kind === live.kind ? { ...live, text: live.text + value.text } : value;
        screen.draft(
          live.kind === "reasoning" ? reasoningDraft(live.text) : assistantBlock(live.text),
          true,
        );
        break;
      case "phase":
        if (value.name !== phase) {
          phase = value.name;
          phaseSince = Date.now();
        }
        break;
      case "sealed":
        screen.sealDraft();
        live = { kind: "text", text: "" };
        break;
      case "empty":
        if (!produced) screen.print(noticeBlock("(no response)"), false);
        break;
      case "idle":
        void fire(registry, "idle", {}, onExtensionFailure);
        maybeCompact();
        // anything still buffered belongs to the turn that just ended
        chat.flush();
        screen.sealDraft();
        live = { kind: "text", text: "" };
        void fire(registry, "turn_end", { text: lastAnswer }, onExtensionFailure);
        void saveSession(session);
        break;
    }
    repaint();
  };

  const screen = await createScreen({
    promptHistory,
    sessionId: session.id,
    onPromptHistory: (prompts) => {
      void savePromptHistory(prompts);
    },
    // An `input` handler can rewrite what was typed or swallow it entirely, so
    // the send waits on the hooks rather than racing them.
    onFileSearch: (query) => fileCandidates(root, query),
    // `@path` keeps its place in what the transcript shows — it is what was
    // typed — while the file's contents ride along with the message.
    onSubmit: (text, kind) => {
      // Enter on an empty composer means "carry on" after Esc held the queue,
      // and nothing at all otherwise. It never reaches an extension's `input`
      // hook: there is no input.
      if (text.trim() === "") {
        chat.release();
        repaint();
        return;
      }
      void fire(registry, "input", { text }, onExtensionFailure).then(async (said) => {
        if (said === false) {
          repaint();
          return;
        }
        const typed = said ?? text;
        const { prompt, attached, missing } = await expandMentions(root, typed);
        for (const path of missing)
          render({ type: "notice", text: `(no such file: @${path} — sent as text)` });
        chat.send(prompt, attached.length === 0 ? null : typed, kind);
        repaint();
      });
    },
    // Alt+Up. The message leaves the queue and comes back to the composer, so
    // rescinding and editing are the same gesture: retype it and press Enter,
    // or clear the line and it is gone.
    onUnqueue: () => {
      const taken = chat.unqueue();
      if (taken !== null) screen.restoreInput(taken.label ?? taken.text);
      repaint();
    },
    onShell: (command) => {
      screen.print(userBlock(`!${command}`), true);
      void fire(registry, "user_bash", { command }, onExtensionFailure);
      void runShell(root, command).then(({ output, ok }) => {
        if (output !== "") screen.print(noticeBlock(output, ok ? "muted" : "danger"), false);
        repaint();
      });
    },
    cwd: root,
    onCommand: (name, args) => {
      // An extension's command runs its own code rather than becoming a turn,
      // so it is dispatched before the body-is-the-prompt path below.
      const runner = registry.runners.get(name);
      if (runner) {
        screen.print(userBlock(`/${name}${args === "" ? "" : ` ${args}`}`), true);
        void (async () => {
          try {
            await runner(args);
          } catch (thrown) {
            onExtensionFailure(`/${name} failed: ${errorText(thrown)}`);
          }
          repaint();
        })();
        return;
      }
      // A command defined in a file or by a skill trigger has no code of its
      // own: its body becomes the turn.
      const custom = commandByName(name);
      if (custom?.body !== undefined) {
        chat.send(expandCommand(custom.body, args), `/${name}${args === "" ? "" : ` ${args}`}`);
        repaint();
        return;
      }
      // Falling off the end silently cleared the composer and produced no turn,
      // which reads as the app being dead.
      render({ type: "notice", text: `(unknown command: /${name} — /help lists what exists)` });
      repaint();
    },
    onKeyBinding: (event) => {
      const bound = registry.keys.find(
        (spec) =>
          spec.key === event.name &&
          (spec.ctrl ?? false) === (event.ctrl ?? false) &&
          (spec.shift ?? false) === (event.shift ?? false),
      );
      if (!bound) return false;
      event.stopPropagation();
      void (async () => {
        try {
          await bound.run();
        } catch (thrown) {
          onExtensionFailure(`key ${bound.key} failed: ${errorText(thrown)}`);
        }
        repaint();
      })();
      return true;
    },
    onEscape: () => interrupt(),
    onResize: () => repaint(),
    onQuit: () => quit(),
  });

  // Compaction is the answer to a full context that is not "throw it away".
  // Automatic once the provider says the conversation is past COMPACT_AT of the
  // window, which is early enough that the summarising call still fits.
  const COMPACT_AT = 0.75;
  const KEEP_TOKENS = 20_000;
  let compactedAt = 0;

  const runCompaction = async (
    options: { instruction?: string; keep?: number },
    automatic: boolean,
  ) => {
    const before = tokens;
    const outcome = await chat.compact(
      options.instruction ?? "Summarise the conversation so far.",
      options.keep ?? KEEP_TOKENS,
      // Asked for by hand, compact whatever there is rather than declining
      // because the conversation has not yet reached the automatic threshold.
      !automatic,
    );
    if (outcome.outcome === "compacted") {
      compactedAt = tokens ?? 0;
      render({
        type: "notice",
        text:
          `(compacted — ${outcome.dropped} messages summarised, ${outcome.kept} kept` +
          `${before === null ? "" : `, from ${before} tokens`})`,
      });
      await fire(
        registry,
        "compact",
        { dropped: outcome.dropped, kept: outcome.kept, automatic },
        onExtensionFailure,
      );
    } else if (outcome.outcome === "failed")
      render({ type: "error", text: `(compaction failed: ${outcome.error})` });
    repaint();
    return outcome;
  };

  const maybeCompact = (): void => {
    if (chat.compacting || model.context === undefined || tokens === null) return;
    if (tokens < model.context * COMPACT_AT) return;
    // Only once per growth phase: without this a compaction that frees little
    // would run again on the very next turn.
    if (tokens <= compactedAt) return;
    void runCompaction({}, true);
  };

  const onExtensionFailure = (message: string): void => {
    render({ type: "error", text: `(extension) ${message}` });
  };

  let replayRun = NO_TOOL_RUN;
  for (const event of session.events) {
    const stepped = advanceToolRun(replayRun, event);
    replayRun = stepped.run;
    if (stepped.footer.length > 0) screen.print(stepped.footer, false);
    const { lines, gap } = eventBlock(
      event.type === "assistant" ? { ...event, text: shown(event.text) } : event,
      renderTool,
      screen.columnsNow(),
    );
    if (lines.length > 0) screen.print(lines, gap);
  }

  // The picker is gone; this is metadata only. Context size and pricing feed
  // the status line's `ctx 12.3k(6%)` and the cost, and there is no denominator
  // without it. Silent on failure: offline, the line reads `unknown`.
  void modelMetadata(model)
    .then((metadata) => {
      model = { ...model, ...metadata };
      agent.setModel(model);
      repaint();
    })
    .catch(() => {});

  const chat = createChat(agent, {
    onEvent: render,
    onSignal: react,
    onBeforeRequest: async (prompt, messages) => {
      const added = await fire(
        registry,
        "before_request",
        { prompt, messages },
        onExtensionFailure,
      );
      return typeof added === "string" ? added : undefined;
    },
    history: messagesOf(session.events),
    steeringMode: config.config.steering_mode,
    followUpMode: config.config.follow_up_mode,
  });

  // Loaded after the screen exists, so a failure has somewhere to be seen, and
  // before the first turn, so a tool registered on the way up is callable.
  // Hoisted so /reload can hand the same host to a second load. It was an
  // inline literal, which is part of why extensions could only ever load once.
  const extensionHost: ExtensionHost = {
    root,
    exec: (command, args) => runShell(root, command, args),
    mode: "tui" as const,
    send: (text, options) => {
      chat.send(text, options.label ?? null, options.steer === true ? "steer" : "follow-up");
      repaint();
    },
    setInput: (text) => {
      screen.restoreInput(text);
      repaint();
    },
    print: (content, tone) => {
      // A tone passed with Line[] used to be dropped on the floor, because it
      // only ever reached noticeBlock. It is a default now: spans that name
      // their own tone keep it, and the ones that do not take this.
      const lines =
        typeof content === "string"
          ? noticeBlock(content, tone)
          : content.map((line) => line.map((span) => ({ tone, ...span })));
      screen.print(lines, false);
      repaint();
    },
    columns: () => screen.columnsNow(),
    capture: (spec) => screen.capture(spec),
    inspect: () => ({
      commands: commands(),
      skills: skills.summaries,
      extensions: loaded.extensions.map((entry) => ({
        ...entry,
        contributed: describeContribution(registry, entry.origin),
      })),
    }),
    clear: () => {
      const outcome = chat.clear();
      if (outcome === "cleared") render({ type: "cleared", reason: "user cleared" });
      return outcome;
    },
    tools: () => agent.toolNames(),
    setToolFilters: (filters) => agent.setToolFilters(filters),
    model: () => ({
      label: modelLabel(model),
      provider: model.provider,
      modelId: model.modelId,
      variant: model.variant,
      variants: model.variants,
      context: model.context,
    }),
    models: async () => {
      const catalogue = await loadCatalogue();
      return catalogue.map((option) => ({
        label: modelLabel(option),
        provider: option.provider,
        modelId: option.modelId,
        variants: option.variants,
        context: option.context,
      }));
    },
    setModel: async (label, variant) => {
      const ref = modelRef(label);
      const next = { ...currentModel(config.config), ...ref, name: label, variant };
      model = { ...next, ...(await modelMetadata(next).catch(() => ({}))) };
      agent.setModel(model);
      await fire(
        registry,
        "model_select",
        { model: modelLabel(model), variant: model.variant },
        onExtensionFailure,
      );
      repaint();
    },
    idle: () => !chat.busy,
    pending: () => chat.queued.length,
    abort: () => chat.abort(),
    usage: () => ({
      tokens,
      context: model.context,
      last: lastUsage,
      // From the session's own events, so a resumed run reports what the
      // whole session cost rather than what it cost since reopening.
      total: usageTotals(session.events),
    }),
    systemPrompt: () => agent.prompt(),
    shutdown: () => quit(),
    session: () => ({
      id: session.id,
      file: sessionFile(session.id),
      title: session.title,
      events: session.events.length,
    }),
    setSessionName: (title) => {
      session.title = title;
      void saveSession(session);
    },
    appendEntry: (type, data) => {
      record({ type: "custom", custom: type, data });
    },
    // Read back out of the session's own events, so a resumed session sees
    // what earlier turns wrote without anything having to persist twice.
    entries: (type) =>
      session.events.flatMap((event) =>
        event.type === "custom" && event.custom === type ? [event.data] : [],
      ),
    compact: (options) => runCompaction(options ?? {}, false),
    reload: async () => {
      const [refreshedCommands, refreshedSkills] = await Promise.all([
        loadUserCommands(root),
        loadSkills(root),
      ]);
      userCommands = refreshedCommands;
      skills = refreshedSkills;
      // /reload is when a skill file was just edited, so it is the moment its
      // mistakes matter most.
      for (const warning of refreshedSkills.warnings)
        render({ type: "notice", text: `(skill) ${warning}` });
      // Extensions too. They were the one thing reload did not touch, so
      // installing one — which is what glorious does when it extends itself for
      // you — meant restarting to see it, while the reload message reported a
      // success that said nothing about the omission.
      resetRegistry(registry);
      agent.setToolFilters([]);
      loaded = await loadAllExtensions(String(Date.now()));
      for (const failure of loaded.failures)
        render({ type: "error", text: `(extension ${failure.origin}) ${failure.message}` });
      registerCommands();
      agent.setSkills(refreshedSkills);
      repaint();
    },
  };

  const loadAllExtensions = (token?: string) =>
    loadExtensions(root, registry, extensionHost, (event) => toolSink(event), token);

  let loaded = await loadAllExtensions();
  registerCommands();
  for (const failure of loaded.failures)
    render({ type: "error", text: `(extension ${failure.origin}) ${failure.message}` });
  // Config problems were reported only by `glorious doctor`, which is a command
  // you run once you already suspect something — and a config that silently does
  // nothing gives you nothing to suspect. A model set in a file that was never
  // read looks exactly like a model that was never set.
  for (const note of resolvedConfig.diagnostics)
    render({ type: "notice", text: `(config) ${note}` });
  // A skill file that could not be read said nothing and simply was not there,
  // which looks exactly like a skill nobody wrote. Same bet as extensions: say
  // what is wrong, keep going with what loaded.
  for (const warning of skills.warnings) render({ type: "notice", text: `(skill) ${warning}` });
  // A tool_call handler returning false refuses the call; the model is told so
  // by name, which is what lets an extension implement a read-only mode or a
  // confirmation gate without the core knowing either exists.
  for (const [name, value] of extraFlags) {
    const flag = registry.flags.get(name);
    if (!flag) {
      render({ type: "notice", text: `(unknown flag: --${name})` });
      continue;
    }
    try {
      await flag.run(value);
    } catch (thrown) {
      onExtensionFailure(`--${name} failed: ${errorText(thrown)}`);
    }
  }

  setToolGate({
    before: async (name, input) => {
      const verdict = await fire(registry, "tool_call", { name, input }, onExtensionFailure);
      if (verdict === false) return `ERROR: an extension blocked ${name} for this turn.`;
      return typeof verdict === "string" ? `ERROR: ${verdict}` : undefined;
    },
    after: async (name, input, ok, result, elapsedMs) => {
      const replaced = await fire(
        registry,
        "tool_end",
        { name, input, ok, result, detail: firstDetail(input), elapsedMs },
        onExtensionFailure,
      );
      return typeof replaced === "string" ? replaced : undefined;
    },
  });
  await fire(registry, "session_start", { root }, onExtensionFailure);

  let release = (): void => {};
  const closed = new Promise<void>((resolve) => {
    release = resolve;
  });

  // One job: stop. The turn is aborted and the queue is held rather than
  // marching on into whatever state the interrupt left behind. Nothing is
  // taken out of the composer and nothing is put into it — Alt+Up is the key
  // for that, and Enter on an empty line lets the queue run again.
  const interrupt = (): boolean => chat.abort();

  // The teardown waits on session_end, so an extension that writes a file or
  // posts a result on the way out actually finishes. It cannot usefully print:
  // the screen stops as soon as this resolves.
  const quit = (): void => {
    chat.abort();
    void fire(registry, "session_end", { root }, onExtensionFailure).finally(release);
  };

  const onSigint = (): void => {
    if (!interrupt()) quit();
  };

  // Nothing animates any more; the only thing that moves between ticks is an
  // elapsed reading, which carries one decimal. Every paint routes through the
  // painter dedupe in screen.ts, so a tick where no number changed reaches the
  // renderer not at all.
  const ticker = setInterval(repaint, TICK_MS);

  // The TUI owns the terminal. Anything the runtime prints on its own — an
  // unhandled rejection, a stack trace — lands at whatever cursor position
  // happens to be current and shreds the screen. Route it into the transcript
  // rather than letting it through.
  const onStray = (reason: unknown): void => {
    render({ type: "error", text: errorText(reason) });
  };

  try {
    screen.start();
    repaint();
    process.on("SIGINT", onSigint);
    process.on("unhandledRejection", onStray);
    process.on("uncaughtException", onStray);
    await closed;
    process.exitCode = 0;
  } finally {
    clearInterval(ticker);
    process.off("SIGINT", onSigint);
    process.off("unhandledRejection", onStray);
    process.off("uncaughtException", onStray);
    screen.stop();
  }
};

try {
  await main();
} catch (thrown) {
  process.stderr.write(`${errorText(thrown)}\n`);
  process.exitCode = 1;
}
