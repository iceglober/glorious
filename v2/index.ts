import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import packageJson from "../package.json";
import { createAgent } from "./agent";
import { approveMcp } from "./approvals";
import { type ChatSignal, createChat } from "./chat";
import { commandByName, expandCommand, setCustomCommands } from "./commands";
import { loadConfig, writeConfigLayer } from "./config";
import { messagesOf, type SessionEvent } from "./events";
import { loadExtensions } from "./extensions";
import { loadAgentRules } from "./guidance";
import { doctorMcp, resolveMcpServers, startMcp } from "./mcp";
import { currentModel, loadModels, loadProviders, modelLabel } from "./models";
import { MODES, type Mode, modeByName, nextMode } from "./modes";
import { PLAN_OPTIONS, PLAN_QUESTION, planBlock, planVerdict } from "./plan";
import { shortcutPrompt } from "./prompt";
import {
  assistantBlock,
  clip,
  errorText,
  eventBlock,
  flatten,
  type Line,
  noticeBlock,
  queuedRow,
  reasoningDraft,
  runningRow,
  statusLine,
  userBlock,
} from "./render";
import { providerKey, saveProviderKey } from "./secrets";
import {
  createSession,
  loadPromptHistory,
  openSession,
  savePromptHistory,
  saveSession,
} from "./session";
import { loadSkills } from "./skills";
import { runShell } from "./tools";
import { createScreen, pickSession } from "./ui";
import { loadUserCommands } from "./usercommands";

const FRAME_MS = 90;
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
  let resumeId: string | undefined;
  const doctor = args.length > 0 && args[0] === "doctor";
  const doctorJson = doctor && args[1] === "--json";
  if (args.length > 0 && !doctor) {
    if (args[0] !== "--resume" || args.length > 2)
      throw new Error(
        "Usage: glorious [--version | update | doctor [--json] | --resume [session-id]]",
      );
    resumeId = args[1];
  }
  if (doctor && args.length > 2)
    throw new Error(
      "Usage: glorious [--version | update | doctor [--json] | --resume [session-id]]",
    );
  const { root, os, branch, worktree, git, label } = probe();
  const resolvedConfig = await loadConfig(root);
  if (doctor) {
    const report = {
      diagnostics: resolvedConfig.diagnostics,
      model: currentModel(resolvedConfig.config),
      mcp: await doctorMcp(root, await resolveMcpServers(root, resolvedConfig)),
    };
    if (doctorJson) process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    else {
      const lines = [
        `model: ${modelLabel(report.model)}`,
        ...report.diagnostics.map((diagnostic) => `${diagnostic.layer}: ${diagnostic.message}`),
        ...report.mcp.servers.map(
          (server) =>
            `mcp ${server.name}: ${server.status ?? "active"} (${server.source ?? "user"})`,
        ),
        ...report.mcp.notes,
      ];
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
  let config = resolvedConfig;
  let model = currentModel(config.config);
  let mcp = await startMcp(root, await resolveMcpServers(root, config));
  let skills = await loadSkills(root, mcp);
  // Slash commands come from two places: markdown files in a commands
  // directory, and skills that declare a trigger of their own.
  let userCommands = await loadUserCommands(root);
  const registerCommands = (): void => setCustomCommands([...skills.commands, ...userCommands]);
  registerCommands();
  // Extensions are deliberately not commands: they never reach the model, so
  // they stay out of the table the model's slash commands live in.
  let extensions = await loadExtensions(root);

  let frame = 0;
  const lastUsage = session.events.findLast((event) => event.type === "usage");
  let tokens = session.contextTokens ?? (lastUsage?.type === "usage" ? lastUsage.tokens : null);
  let produced = false;
  // what the current draft block is showing, so deltas append rather than replace
  let live: { kind: "text" | "reasoning"; text: string } = { kind: "text", text: "" };
  // what the model call is doing, and since when — the wave shows both
  let phase: "sending" | "waiting" | "thinking" | "writing" | null = null;
  let phaseSince = Date.now();
  const running: Array<{ id: number; name: string; detail: string; since: number }> = [];
  // Live subagents for this turn. Their tool calls are kept out of the
  // transcript, so this is the only place they exist to be looked at.
  type Subagent = {
    id: number;
    task: string;
    stream: Array<{ name: string; detail: string; ok: boolean | null }>;
    tools: number;
    since: number;
    done: boolean;
  };
  const subagents: Subagent[] = [];
  let watching = 0;

  const repaint = (): void => {
    // one paint per frame for however many deltas landed since the last one
    chat.flush();
    const now = Date.now();
    const progress: Line[] = [];
    for (const tool of running) {
      if (now - tool.since < SETTLE_MS) continue;
      // A subagent's own calls never reach the transcript, so its row carries
      // the evidence that work is happening: how much, and for how long.
      const agent = subagents.find((entry) => entry.id === tool.id);
      // Counts first: the brief is long, so anything appended after it is clipped
      // off the end of the row and never seen.
      const detail =
        agent === undefined
          ? tool.detail
          : `${agent.tools} tools · ${Math.round((now - agent.since) / 1000)}s · ctrl+b   ${clip(flatten(tool.detail), 60)}`;
      progress.push(runningRow(tool.name, detail, frame));
    }
    for (const text of chat.queued) progress.push(queuedRow(text));
    screen.setProgress(progress);
    if (screen.watchingSubagents()) screen.refreshSubagents(subagents, watching);
    screen.setWave(
      frame,
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
    mcp,
    askQuestions: (questions, signal) => screen.askQuestions(questions, signal),
    presentPlan: async ({ plan, files }, signal) => {
      // Show the plan in the transcript first — the approval prompt sits in the
      // composer and has no room to hold the thing being approved.
      render({ type: "assistant", text: planBlock(plan, files) });
      const verdict = planVerdict(
        await screen.askQuestions([{ question: PLAN_QUESTION, options: PLAN_OPTIONS }], signal),
      );
      if (verdict.decision === "approved") chat.planApproved(plan, files, verdict.fresh);
      if (verdict.decision === "feedback") screen.restoreInput(verdict.note);
      return verdict;
    },
  });

  const replaceMcp = async (): Promise<void> => {
    const nextConfig = await loadConfig(root);
    const nextMcp = await startMcp(root, await resolveMcpServers(root, nextConfig));
    const previous = mcp;
    const previousHealthy = previous.servers.some((server) => server.status === "active");
    const nextHealthy = nextMcp.servers.some((server) => server.status === "active");
    const nextFailed = nextMcp.servers.some((server) => server.status === "failed");
    if (previousHealthy && !nextHealthy && nextFailed) {
      nextMcp.close();
      throw new Error("MCP reload failed; keeping the current connected servers.");
    }
    config = nextConfig;
    mcp = nextMcp;
    agent.setMcp(nextMcp);
    skills = await loadSkills(root, nextMcp);
    registerCommands();
    agent.setSkills(skills);
    previous.close();
    repaint();
  };

  // Both the picker and the Tab shortcut land here, so the composer label can
  // never disagree with the mode actually in force.
  const applyMode = (next: Mode): void => {
    agent.setMode(next);
    screen.setMode(next);
    repaint();
  };

  const cycleMode = (): void => applyMode(nextMode(agent.mode().name));

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
    if (event.type === "user") produced = false;
    if (event.type === "assistant" || event.type === "tool") produced = true;
    const { lines, gap } = eventBlock(event);
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
        const { origin } = value.tool;
        if (origin !== undefined) {
          // A subagent's own call belongs to that subagent's stream, which the
          // transcript never shows — this is the only record it has.
          const owner = subagents.find((entry) => entry.id === origin);
          if (!owner) break;
          if (value.tool.phase === "start") {
            owner.stream.push({ name: value.tool.name, detail: value.tool.detail, ok: null });
            break;
          }
          const open = owner.stream.findLast(
            (step) => step.name === value.tool.name && step.ok === null,
          );
          if (open) open.ok = value.tool.ok;
          owner.tools += 1;
          break;
        }
        if (value.tool.phase === "start") {
          const { id, name, detail } = value.tool;
          running.push({ id, name, detail, since: Date.now() });
          if (name === "run_subagent")
            subagents.push({
              id,
              task: detail,
              stream: [],
              tools: 0,
              since: Date.now(),
              done: false,
            });
          break;
        }
        const slot = running.findIndex((tool) => tool.id === value.tool.id);
        if (slot >= 0) running.splice(slot, 1);
        const ended = subagents.find((entry) => entry.id === value.tool.id);
        if (ended) ended.done = true;
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
        subagents.length = 0;
        watching = 0;
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
    onSubmit: (text) => {
      chat.send(text);
      repaint();
    },
    onShell: (command) => {
      screen.print(userBlock(`!${command}`), true);
      void runShell(root, command).then(({ output, ok }) => {
        if (output !== "") screen.print(noticeBlock(output, ok ? "muted" : "danger"), false);
        repaint();
      });
    },
    extensions,
    // An extension runs first and asks questions afterwards: the shell is the
    // point, and the prompt — if the file carries one — is a consequence of it.
    // A failed run produces neither, so a reset that did not happen cannot look
    // like one that did.
    onShortcut: (name, args) => {
      const extension = extensions.find((entry) => entry.name === name);
      if (extension === undefined) {
        render({ type: "notice", text: `(unknown extension: $${name})` });
        return;
      }
      const invocation = `$${name}${args === "" ? "" : ` ${args}`}`;
      screen.print(userBlock(invocation), true);
      const words = args === "" ? [] : args.split(/\s+/u);
      void runShell(root, extension.run, words).then(({ output, stdout, ok }) => {
        if (output !== "") screen.print(noticeBlock(output, ok ? "muted" : "danger"), false);
        if (!ok) {
          repaint();
          return;
        }
        if (extension.clear) {
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
        if (extension.body !== "")
          chat.send(
            shortcutPrompt(expandCommand(extension.body, args), stdout),
            `(prompt from ${invocation})`,
          );
        repaint();
      });
    },
    cwd: root,
    onCommand: (name, args) => {
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
      if (name === "mcp") screen.showMcp(mcp.servers, mcp.notes);
      if (name === "mode")
        screen.showModes(MODES, agent.mode().name, (chosen) => {
          const next = modeByName(chosen);
          if (next) applyMode(next);
        });
      if (name === "models") {
        const selectModel = (next: typeof model): void => {
          agent.setModel(next);
          model = next;
          void writeConfigLayer("local", root, (current) => ({
            ...current,
            model: { selected: modelLabel(next), variant: next.variant },
            providers: { ...current.providers, [next.provider]: { enabled: true } },
          }))
            .then(() => loadConfig(root))
            .then((nextConfig) => {
              config = nextConfig;
            })
            .catch((failure) => screen.showModelError(errorText(failure)));
          repaint();
        };
        const showModels = (options: Awaited<ReturnType<typeof loadModels>>): void =>
          screen.showModels(options, selectModel, showProviders);
        const selectProvider = (provider: string, apiKey?: string): void => {
          void loadModels(model, config.config, provider, apiKey)
            .then(showModels)
            .catch((failure) => screen.showModelError(errorText(failure)));
        };
        const showProviders = (): void => {
          void loadProviders(config.config)
            .then((providers) =>
              screen.showProviders(
                providers,
                (provider) => {
                  if (provider.env.length === 0) {
                    selectProvider(provider.id);
                    return;
                  }
                  void providerKey(provider.id)
                    .then((stored) => {
                      if (stored) {
                        selectProvider(provider.id, stored);
                        return;
                      }
                      screen.showProviderKey(
                        provider,
                        (key) => {
                          if (key === "") {
                            selectProvider(provider.id);
                            return;
                          }
                          void saveProviderKey(provider.id, key)
                            .then(() => selectProvider(provider.id, key))
                            .catch((failure) => screen.showModelError(errorText(failure)));
                        },
                        showProviders,
                      );
                    })
                    .catch((failure) => screen.showModelError(errorText(failure)));
                },
                () => void loadModels(model, config.config).then(showModels),
              ),
            )
            .catch((failure) => screen.showModelError(errorText(failure)));
        };
        void loadModels(model, config.config)
          .then(showModels)
          .catch((failure) => screen.showModelError(errorText(failure)));
      }
      repaint();
    },
    onModeCycle: cycleMode,
    // Ctrl+O opens the stream the transcript no longer carries. With nothing
    // running there is nothing to show, so the key does nothing and the hint
    // stays hidden.
    onWatchSubagents: () => {
      if (subagents.length === 0) return;
      watching = Math.min(watching, subagents.length - 1);
      screen.showSubagents(subagents, watching);
    },
    onCycleSubagent: () => {
      if (subagents.length === 0) return;
      watching = (watching + 1) % subagents.length;
      screen.refreshSubagents(subagents, watching);
    },
    onSkillsReload: () => {
      void loadUserCommands(root).then((refreshed) => {
        userCommands = refreshed;
        registerCommands();
      });
      void loadExtensions(root).then((refreshed) => {
        extensions = refreshed;
        screen.setExtensions(refreshed);
      });
      void loadSkills(root).then((refreshed) => {
        skills = refreshed;
        agent.setSkills(refreshed);
        screen.showSkills(skills.summaries);
        repaint();
      });
    },
    onMcpReload: (setLoading) => {
      setLoading(true);
      void replaceMcp()
        .catch((failure) => screen.showModelError(errorText(failure)))
        .finally(() => setLoading(false));
    },
    onMcpApprove: (name) => {
      const server = mcp.servers.find((item) => item.name === name && item.status === "unapproved");
      if (!server?.fingerprint) return;
      void approveMcp({ root: resolve(root), name, fingerprint: server.fingerprint })
        .then(replaceMcp)
        .catch((failure) => screen.showModelError(errorText(failure)));
    },
    onEscape: () => interrupt(),
    onResize: () => repaint(),
    onQuit: () => quit(),
  });

  for (const event of session.events) {
    const { lines, gap } = eventBlock(event);
    if (lines.length > 0) screen.print(lines, gap);
  }

  void loadModels(model, config.config)
    .then((options) => {
      const metadata = options.find((option) => modelLabel(option) === modelLabel(model));
      if (metadata) {
        model = metadata;
        agent.setModel(metadata);
        repaint();
      }
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
    mcp.close();
    release();
  };

  const onSigint = (): void => {
    if (!interrupt()) quit();
  };

  const ticker = setInterval(() => {
    frame += 1;
    repaint();
  }, FRAME_MS);

  // The TUI owns the terminal. Anything the runtime prints on its own — an
  // unhandled rejection, a stack trace — lands at whatever cursor position
  // happens to be current and shreds the screen. Route it into the transcript
  // rather than letting it through.
  const onStray = (reason: unknown): void => {
    render({ type: "error", text: errorText(reason) });
  };

  try {
    screen.start();
    screen.setMode(agent.mode());
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
