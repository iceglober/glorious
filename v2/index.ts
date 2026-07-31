import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { createAgent } from "./agent";
import { type ChatEvent, createChat } from "./chat";
import {
  assistantBlock,
  errorText,
  type Line,
  noticeBlock,
  queuedRow,
  runningRow,
  statusLine,
  toolRow,
  userBlock,
} from "./render";
import type { ToolEvent } from "./tools";
import { createScreen } from "./ui";

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
  const { root, os, git, label } = probe();
  const rules = join(root, "AGENTS.md");
  const model = process.env.GLORIOUS_MODEL ?? "gpt-5.6-luna";

  let frame = 0;
  let tokens = 0;
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
        { root: label, model, tokens, busy: chat.busy, queued: chat.queued.length, frame },
        screen.columns(),
      ),
    );
  };

  const onTool = (event: ToolEvent): void => {
    const now = Date.now();
    if (event.phase === "start") {
      running.push({ id: event.id, name: event.name, detail: event.detail, since: now });
      repaint();
      return;
    }
    const slot = running.findIndex((tool) => tool.id === event.id);
    const [started] = running.splice(slot, 1);
    produced = true;
    screen.print([toolRow(event.name, started.detail, now - started.since, event.ok)], false);
    repaint();
  };

  const agent = createAgent({
    root,
    model,
    rules: existsSync(rules) ? readFileSync(rules, "utf8") : "",
    cwd: root,
    os,
    date: new Date().toISOString().slice(0, 10),
    git,
    onTool,
  });

  const render = (event: ChatEvent): void => {
    switch (event.type) {
      case "usage":
        tokens = event.tokens;
        break;
      case "user":
        produced = false;
        screen.print(userBlock(event.text), true);
        break;
      case "assistant":
        produced = true;
        screen.print(assistantBlock(event.text), true);
        break;
      case "empty":
        if (!produced) screen.print(noticeBlock("(no response)"), false);
        break;
      case "notice":
        screen.print(noticeBlock(event.text), false);
        break;
      case "error":
        screen.print(noticeBlock(event.text, "danger"), false);
        break;
      case "dequeued":
        screen.restoreInput(event.text);
        screen.print(noticeBlock(`(dequeued) ${event.text.split("\n")[0].slice(0, 60)}`), false);
        break;
    }
    repaint();
  };

  const screen = await createScreen({
    onSubmit: (text) => {
      chat.send(text);
      repaint();
    },
    onEscape: () => interrupt(),
    onResize: () => repaint(),
    onQuit: () => quit(),
  });

  const chat = createChat(agent, render);

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
