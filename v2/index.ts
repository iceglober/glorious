import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { createAgent } from "./agent";
import { loadAgentRules } from "./guidance";
import { type ChatSignal, createChat } from "./chat";
import { messagesOf, type SessionEvent } from "./events";
import { readMcpConfig, startMcp } from "./mcp";
import {
  errorText,
  eventBlock,
  type Line,
  noticeBlock,
  queuedRow,
  userBlock,
  runningRow,
  statusLine,
} from "./render";
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
    git: `${branch === "" ? "HEAD" : branch} ${dirty === 0 ? "clean" : `${dirty} files changed`}`,
    label: root === home || root.startsWith(`${home}/`) ? `~${root.slice(home.length)}` : root,
  };
};

const main = async (): Promise<void> => {
  const args = process.argv.slice(2);
  let resumeId: string | undefined;
  if (args.length > 0) {
    if (args[0] !== "--resume" || args.length > 2)
      throw new Error("Usage: glorious [--resume [session-id]]");
    resumeId = args[1];
  }
  const { root, os, git, label } = probe();
  const session =
    resumeId === undefined && args.length === 0
      ? await createSession(root)
      : await openSession(resumeId, pickSession);
  const promptHistory = await loadPromptHistory();
  const rules = await loadAgentRules(root);
  const model = process.env.GLORIOUS_MODEL ?? "gpt-5.6-luna";
  const mcp = await startMcp(root, await readMcpConfig(root));
  let skills = await loadSkills(root, mcp);

  let frame = 0;
  let tokens = session.contextTokens ?? null;
  let cached: number | null = null;
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
    screen.setStatus(
      statusLine(
        {
          root: label,
          model,
          tokens,
          cached,
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
      void mcp
        .reload()
        .then(() => {
          agent.setMcp(mcp);
          repaint();
        })
        .finally(() => setLoading(false));
    },
    onEscape: () => interrupt(),
    onResize: () => repaint(),
    onQuit: () => quit(),
  });

  for (const event of session.events) {
    const { lines, gap } = eventBlock(event);
    if (lines.length > 0) screen.print(lines, gap);
  }

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
