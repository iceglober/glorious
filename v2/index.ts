import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import packageJson from "../package.json";
import { createAgent } from "./agent";
import { type ChatSignal, createChat } from "./chat";
import { commandByName, expandCommand, setCustomCommands } from "./commands";
import { loadConfig } from "./config";
import { messagesOf, type SessionEvent } from "./events";
import { createRegistry, describeContribution, fire } from "./extension-api";
import { loadExtensions } from "./extensions";
import { loadAgentRules } from "./guidance";
import { currentModel, modelLabel, modelMetadata } from "./models";
import { runPrint } from "./print";
import { shortcutPrompt } from "./prompt";
import {
  assistantBlock,
  errorText,
  eventBlock,
  type Line,
  noticeBlock,
  queuedRow,
  reasoningDraft,
  runningRow,
  statusLine,
  userBlock,
} from "./render";
import { loadSequences } from "./sequences";
import {
  createSession,
  loadPromptHistory,
  openSession,
  savePromptHistory,
  saveSession,
} from "./session";
import { loadSkills } from "./skills";
import { runShell, type ToolEvent } from "./tools";
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
  "Usage: glorious [--version | update | doctor [--json] | --resume [session-id] | -p <prompt>]";

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
  // Headless, and handled before anything opens the terminal: the whole point
  // is that this path never touches the alternate screen.
  if (args[0] === "-p" || args[0] === "--print") {
    const prompt = args.slice(1).join(" ").trim();
    if (prompt === "") throw new Error("Nothing to run: -p needs a prompt.");
    const { root, os, git } = probe();
    process.exitCode = await runPrint(prompt, { root, os, git });
    return;
  }
  let resumeId: string | undefined;
  const doctor = args.length > 0 && args[0] === "doctor";
  const doctorJson = doctor && args[1] === "--json";
  if (args.length > 0 && !doctor) {
    if (args[0] !== "--resume" || args.length > 2) throw new Error(USAGE);
    resumeId = args[1];
  }
  if (doctor && args.length > 2) throw new Error(USAGE);
  const { root, os, branch, worktree, git, label } = probe();
  const resolvedConfig = await loadConfig(root);
  if (doctor) {
    const report = {
      diagnostics: resolvedConfig.diagnostics,
      model: currentModel(resolvedConfig.config),
    };
    if (doctorJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      const lines = [`model: ${modelLabel(report.model)}`, ...report.diagnostics];
      process.stdout.write(`${lines.join("\n")}\n`);
    }
    return;
  }
  const session =
    resumeId === undefined && args.length === 0
      ? await createSession(root)
      : await openSession(resumeId, pickSession);
  const promptHistory = await loadPromptHistory();
  const rules = await loadAgentRules(root);
  const config = resolvedConfig;
  let model = currentModel(config.config);
  let skills = await loadSkills(root);
  // Slash commands come from two places: markdown files in a commands
  // directory, and skills that declare a trigger of their own.
  let userCommands = await loadUserCommands(root);
  // Extensions register commands as they load, so they are merged in here
  // rather than pushed separately — one table, one collision rule.
  const registry = createRegistry();
  const registerCommands = (): void =>
    setCustomCommands([...registry.commands, ...skills.commands, ...userCommands]);
  registerCommands();
  // Sequences are deliberately not commands: they never reach the model, so
  // they stay out of the table the model's slash commands live in.
  let { sequences, legacy: legacySequences } = await loadSequences(root);

  const lastUsage = session.events.findLast((event) => event.type === "usage");
  let tokens = session.contextTokens ?? (lastUsage?.type === "usage" ? lastUsage.tokens : null);
  let produced = false;
  // the last thing the model said, so turn_end can hand it to an extension
  let lastAnswer = "";
  // Where an extension tool's events go. Extension tools are built once at
  // load, but the handler that pairs start with end belongs to whichever turn
  // is running, so the agent points this at the live one each turn.
  let toolSink: (event: ToolEvent) => void = () => {};
  // what the current draft block is showing, so deltas append rather than replace
  let live: { kind: "text" | "reasoning"; text: string } = { kind: "text", text: "" };
  // what the model call is doing, and since when — the wave shows both
  let phase: "sending" | "waiting" | "thinking" | "writing" | null = null;
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
        ),
      );
    }
    for (const text of chat.queued) progress.push(queuedRow(text));
    screen.setProgress(progress);
    screen.setFooter(registry.footers.flatMap((render) => safely(render) ?? []));
    screen.setStatusRow(
      chat.busy,
      chat.queued.length,
      phase === null ? null : { name: phase, ms: now - phaseSince },
    );
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
    sessionId: session.id,
    rules,
    cwd: root,
    os,
    date: new Date().toISOString().slice(0, 10),
    git,
    skills: skills.catalog,
    skillTools: skills,
    askQuestions: (questions, signal) => screen.askQuestions(questions, signal),
    extensionTools: (onTool) => {
      toolSink = onTool;
      return registry.tools;
    },
    extensionPrompt: () => registry.promptLines,
  });

  const record = (event: SessionEvent): void => {
    session.events.push(event);
    session.updatedAt = new Date().toISOString();
    if (event.type === "usage" || event.type === "turn") void saveSession(session);
  };

  const render = (event: SessionEvent): void => {
    record(event);
    if (event.type === "usage") {
      tokens = event.tokens;
      session.contextTokens = event.tokens;
    }
    if (event.type === "user") {
      produced = false;
      void fire(registry, "turn_start", { text: event.text }, onExtensionFailure);
    }
    if (event.type === "assistant") lastAnswer = event.text;
    if (event.type === "assistant" || event.type === "tool") produced = true;
    const { lines, gap } = eventBlock(event, renderTool);
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
        void fire(
          registry,
          "tool_end",
          {
            name: value.tool.name,
            input: value.tool.input,
            ok: value.tool.ok,
            result: value.tool.result,
          },
          onExtensionFailure,
        );
        break;
      }
      case "delta":
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
      case "dequeued":
        screen.restoreInput(value.text);
        screen.print(noticeBlock(`(dequeued) ${value.text.split("\n")[0].slice(0, 60)}`), false);
        break;
      case "idle":
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
    onSubmit: (text) => {
      void fire(registry, "input", { text }, onExtensionFailure).then((said) => {
        if (said === false) {
          repaint();
          return;
        }
        chat.send(said ?? text);
        repaint();
      });
    },
    onShell: (command) => {
      screen.print(userBlock(`!${command}`), true);
      void runShell(root, command).then(({ output, ok }) => {
        if (output !== "") screen.print(noticeBlock(output, ok ? "muted" : "danger"), false);
        repaint();
      });
    },
    sequences,
    // A sequence runs first and asks questions afterwards: the shell is the
    // point, and the prompt — if the file carries one — is a consequence of it.
    // A failed run produces neither, so a reset that did not happen cannot look
    // like one that did.
    onShortcut: (name, args) => {
      const sequence = sequences.find((entry) => entry.name === name);
      if (sequence === undefined) {
        render({ type: "notice", text: `(unknown sequence: $${name})` });
        return;
      }
      const invocation = `$${name}${args === "" ? "" : ` ${args}`}`;
      screen.print(userBlock(invocation), true);
      const words = args === "" ? [] : args.split(/\s+/u);
      void runShell(root, sequence.run, words).then(({ output, stdout, ok }) => {
        if (output !== "") screen.print(noticeBlock(output, ok ? "muted" : "danger"), false);
        if (!ok) {
          repaint();
          return;
        }
        if (sequence.clear) {
          const outcome = chat.clear();
          if (outcome === "cleared") {
            render({ type: "cleared", reason: invocation });
            render({ type: "notice", text: "(context cleared)" });
          } else if (outcome === "busy")
            render({ type: "notice", text: "(context kept — a turn is running)" });
        }
        // The invocation was already echoed above, before the shell ran. Echoing
        // it again as the turn's label would print the same line twice with the
        // output wedged between them.
        if (sequence.body !== "")
          chat.send(
            shortcutPrompt(expandCommand(sequence.body, args), stdout),
            `(prompt from ${invocation})`,
          );
        repaint();
      });
    },
    cwd: root,
    onCommand: (name, args) => {
      // An extension's command runs its own code rather than becoming a turn,
      // so it is dispatched before the body-is-the-prompt path below.
      const runner = registry.runners.get(name);
      if (runner) {
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
      // A command defined in a file or by a skill trigger has no UI action of
      // its own: its body becomes the turn.
      const custom = commandByName(name);
      if (custom && custom.run === null && custom.body !== undefined) {
        chat.send(expandCommand(custom.body, args), `/${name}${args === "" ? "" : ` ${args}`}`);
        repaint();
        return;
      }
      if (name === "clear") {
        const outcome = chat.clear();
        if (outcome === "cleared") {
          render({ type: "cleared", reason: "user cleared" });
          render({ type: "notice", text: "(context cleared)" });
        } else
          render({
            type: "notice",
            text:
              outcome === "busy"
                ? "(cannot clear while a turn is running \u2014 press Esc first)"
                : "(nothing to clear)",
          });
      }
      // Everything below is a builtin. Falling off the end silently cleared the
      // composer and produced no turn, which reads as the app being dead — so an
      // unrecognised command says so instead.
      if (custom === undefined) {
        render({ type: "notice", text: `(unknown command: /${name} — /help lists what exists)` });
        return;
      }
      if (name === "help") screen.showHelp();
      if (name === "skills") screen.showSkills(skills.summaries);
      if (name === "extensions")
        screen.showExtensions(
          loaded.extensions.map((entry) => ({
            ...entry,
            contributed: describeContribution(registry, entry.origin),
          })),
        );
      repaint();
    },
    onSkillsReload: () => {
      void loadUserCommands(root).then((refreshed) => {
        userCommands = refreshed;
        registerCommands();
      });
      void loadSequences(root).then((refreshed) => {
        sequences = refreshed.sequences;
        screen.setSequences(refreshed.sequences);
      });
      void loadSkills(root).then((refreshed) => {
        skills = refreshed;
        agent.setSkills(refreshed);
        screen.showSkills(skills.summaries);
        repaint();
      });
    },
    onEscape: () => interrupt(),
    onResize: () => repaint(),
    onQuit: () => quit(),
  });

  const onExtensionFailure = (message: string): void => {
    render({ type: "error", text: `(extension) ${message}` });
  };

  for (const event of session.events) {
    const { lines, gap } = eventBlock(event, renderTool);
    if (lines.length > 0) screen.print(lines, gap);
  }

  // Loaded after the screen exists, so a failure has somewhere to be seen, and
  // before the first turn, so a tool registered on the way up is callable.
  const loaded = await loadExtensions(
    root,
    registry,
    {
      root,
      exec: (command, args) => runShell(root, command, args),
      send: (text, label) => {
        chat.send(text, label);
        repaint();
      },
      print: (text, tone) => {
        screen.print(noticeBlock(text, tone), false);
        repaint();
      },
      ask: (questions) => screen.askQuestions(questions, undefined),
    },
    (event) => toolSink(event),
  );
  registerCommands();
  for (const failure of loaded.failures)
    render({ type: "error", text: `(extension ${failure.origin}) ${failure.message}` });
  for (const path of legacySequences)
    render({
      type: "notice",
      text: `(${path} is in an extensions/ directory — sequences live in .glorious/sequences/ now; extensions/ is for .ts extensions and this fallback goes away next release)`,
    });
  await fire(registry, "session_start", { root }, onExtensionFailure);

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
    history: messagesOf(session.events),
  });

  let release = (): void => {};
  const closed = new Promise<void>((resolve) => {
    release = resolve;
  });

  const interrupt = (): boolean => chat.dequeue() !== null || chat.abort();

  const quit = (): void => {
    chat.abort();
    release();
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
