import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import packageJson from "../package.json";
import { createAgent } from "./agent";
import { approveMcp } from "./approvals";
import { type ChatSignal, createChat } from "./chat";
import { loadConfig, writeConfigLayer } from "./config";
import { messagesOf, type SessionEvent } from "./events";
import { loadAgentRules } from "./guidance";
import { doctorMcp, resolveMcpServers, startMcp } from "./mcp";
import { currentModel, loadModels, loadProviders, modelLabel } from "./models";
import {
  errorText,
  eventBlock,
  type Line,
  noticeBlock,
  queuedRow,
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

  let frame = 0;
  const lastUsage = session.events.findLast((event) => event.type === "usage");
  let tokens = session.contextTokens ?? (lastUsage?.type === "usage" ? lastUsage.tokens : null);
  let cached: number | null = lastUsage?.type === "usage" ? lastUsage.cached : null;
  let totalTokensIn = session.events.reduce(
    (total, event) => (event.type === "usage" ? total + (event.input ?? event.tokens) : total),
    0,
  );
  let totalTokensOut = session.events.reduce(
    (total, event) => (event.type === "usage" ? total + (event.output ?? 0) : total),
    0,
  );
  let totalCachedTokens = session.events.reduce(
    (total, event) => (event.type === "usage" ? total + event.cached : total),
    0,
  );
  let produced = false;
  const running: Array<{ id: number; name: string; detail: string; since: number }> = [];

  const repaint = (): void => {
    const now = Date.now();
    const progress: Line[] = [];
    for (const tool of running) {
      if (now - tool.since >= SETTLE_MS) progress.push(runningRow(tool.name, tool.detail, frame));
    }
    for (const text of chat.queued) progress.push(queuedRow(text));
    screen.setProgress(progress);
    screen.setWave(frame, chat.busy, chat.queued.length);
    screen.setStatus(
      statusLine(
        {
          cwd: label,
          worktree,
          branch,
          model: `${modelLabel(model)}${model.variant ? ` (${model.variant})` : ""}`,
          tokens,
          percentUsed:
            model.context !== undefined && tokens !== null ? (tokens / model.context) * 100 : null,
          cached,
          totalTokensIn,
          totalTokensOut,
          totalCachedTokens,
          busy: chat.busy,
          queued: chat.queued.length,
          frame,
          sessionId: session.id,
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
    agent.setSkills(skills);
    previous.close();
    repaint();
  };

  const record = (event: SessionEvent): void => {
    session.events.push(event);
    session.updatedAt = new Date().toISOString();
    if (event.type === "usage" || event.type === "turn") void saveSession(session);
  };

  const render = (event: SessionEvent): void => {
    record(event);
    if (event.type === "usage") {
      tokens = event.tokens;
      cached = event.cached;
      totalTokensIn += event.input ?? event.tokens;
      totalTokensOut += event.output ?? 0;
      totalCachedTokens += event.cached;
      session.contextTokens = event.tokens;
    }
    if (event.type === "user") produced = false;
    if (event.type === "assistant" || event.type === "tool") produced = true;
    const { lines, gap } = eventBlock(event);
    if (lines.length > 0) screen.print(lines, gap);
    repaint();
  };

  const react = (value: ChatSignal): void => {
    switch (value.type) {
      case "tool": {
        if (value.tool.phase === "start") {
          const { id, name, detail } = value.tool;
          running.push({ id, name, detail, since: Date.now() });
          break;
        }
        const slot = running.findIndex((tool) => tool.id === value.tool.id);
        if (slot >= 0) running.splice(slot, 1);
        break;
      }
      case "empty":
        if (!produced) screen.print(noticeBlock("(no response)"), false);
        break;
      case "dequeued":
        screen.restoreInput(value.text);
        screen.print(noticeBlock(`(dequeued) ${value.text.split("\n")[0].slice(0, 60)}`), false);
        break;
      case "idle":
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
    cwd: root,
    onCommand: (name) => {
      if (name === "help") screen.showHelp();
      if (name === "skills") screen.showSkills(skills.summaries);
      if (name === "mcp") screen.showMcp(mcp.servers, mcp.notes);
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
    onSkillsReload: () => {
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

  try {
    screen.start();
    repaint();
    process.on("SIGINT", onSigint);
    await closed;
    process.exitCode = 0;
  } finally {
    clearInterval(ticker);
    process.off("SIGINT", onSigint);
    screen.stop();
  }
};

try {
  await main();
} catch (thrown) {
  process.stderr.write(`${errorText(thrown)}\n`);
  process.exitCode = 1;
}
