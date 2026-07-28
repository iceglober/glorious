import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { stderr as processStderr, stdout as processStdout } from "node:process";
import packageJson from "../package.json";
import { type AgentConfig, agentConfigSchema, createAgent, type ToolActivity } from "./lib/agent";
import type { ChatEvent } from "./lib/chat/events";
import { type ChatSession, createChatSession } from "./lib/chat/session";
import { EXIT_FAILURE, EXIT_SUCCESS, runGloriousCli } from "./lib/cli";
import type { PromptContext } from "./lib/prompt";
import { createSpillSink } from "./lib/tools/spill";
import { presentActivityLine, truncateLineWithNotice } from "./lib/tui/chat-event-format";
import type { ChatScreen } from "./lib/tui/chat-screen-types";
import { createOpenTuiChatScreen } from "./lib/tui/opentui-chat-screen";
import { composeProgressLines } from "./lib/tui/progress";
import { composeStatusSection, formatVuMeter } from "./lib/tui/status";
import type { UiSpan, UiTextLine } from "./lib/tui/styles";
import {
  renderToolRow,
  renderTranscriptItem,
  type ToolRow,
  toTranscriptItem,
} from "./lib/tui/transcript-item";
import { createHostExecutionEnvironment } from "./lib/workspace/host-adapter";
import { resolveProjectSource } from "./lib/workspace/project-source";

const COMMAND_VERSION = packageJson.version;

const summarizeStatus = (porcelain: string): string => {
  const count = porcelain.split("\n").filter(Boolean).length;
  return count === 0 ? "clean" : `${count} files changed`;
};

/** Optional request-context ceiling; unset means no ceiling and no meter denominator. */
const contextSoftLimitFromEnv = (): number | undefined => {
  const raw = process.env.GLORIOUS_CONTEXT_SOFT_LIMIT;
  if (!raw) return undefined;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
};

/** The interactive chat session: compose the agent, stand up the OpenTUI
 *  screen, and pump ChatEvents into it until the user quits. */
export async function runGloriousChat(): Promise<number> {
  let screen: ChatScreen | undefined;
  let emitChatEvent: ((event: ChatEvent) => void) | null = null;
  let updateStatus = (): void => {};

  // Live activity: what is running right now, since when. Running tools render
  // as spinner lines in the progress block and freeze into the transcript with
  // elapsed time when they finish.
  let interruptRequested = false;
  // Did the running turn surface anything (a tool row or assistant text)? A
  // turn that ends with none — an empty model reply — otherwise renders
  // nothing, which looks identical to a freeze.
  let turnProducedOutput = false;
  let vuFrame = 0;
  const turnTokens = { ctx: 0 };
  const activeTools = new Map<number, { tool: string; detail: string; startedAt: number }>();

  // Messages queued mid-turn wait visibly in the live region, below running
  // tools and above the editor, until their own turn starts.
  const queuedMessages: Array<{ text: string; transcriptText?: string }> = [];
  const queuedLines = (): string[] =>
    queuedMessages.map(
      ({ text, transcriptText }) =>
        `  ↳ queued: ${truncateLineWithNotice(transcriptText ?? text, 60)}`,
    );

  const refreshProgress = (): void => {
    screen?.setProgressLines(
      composeProgressLines({
        activeTools,
        queued: queuedLines(),
        frame: vuFrame,
      }).map(presentActivityLine),
    );
  };

  const onToolActivity = (activity: ToolActivity): void => {
    if (activity.phase === "start") {
      activeTools.set(activity.id, {
        tool: activity.tool,
        detail: activity.detail,
        startedAt: Date.now(),
      });
    } else {
      const started = activeTools.get(activity.id);
      activeTools.delete(activity.id);
      const elapsedMs = started ? Date.now() - started.startedAt : 0;
      const detail = started?.detail ?? activity.detail;
      turnProducedOutput = true;
      // Stream each finished tool into the transcript so the turn shows what it
      // actually did. Only the ✓ is toned — the row itself stays calm.
      if (screen) {
        const row: ToolRow = { tool: activity.tool, detail, elapsedMs, outcome: "ok" };
        screen.printAbove(renderToolRow(row, { live: false }, screen.width()), "none");
      }
    }
    refreshProgress();
    updateStatus();
  };

  const projectSource = await resolveProjectSource(process.cwd());
  const root = projectSource.projectRoot;
  const environment = await createHostExecutionEnvironment(root);
  // Over-cap tool output spills here in full; tools reference the file in
  // their truncation notices so the model can slice it back in.
  const spillSink = createSpillSink(join(tmpdir(), "glorious-spill"));

  let agentsMd = "";
  try {
    agentsMd = await environment.readFile("AGENTS.md");
  } catch {}
  const config: AgentConfig = agentConfigSchema.parse({
    rules: agentsMd,
    ...(process.env.GLORIOUS_MODEL ? { llm: { model: process.env.GLORIOUS_MODEL } } : {}),
  });
  const ctx: PromptContext = {
    cwd: root,
    os: (await environment.executeCommand("uname -sr")).stdout.trim(),
    date: new Date().toISOString().slice(0, 10),
    gitBranch:
      (await environment.executeCommand("git branch --show-current")).stdout.trim() || "HEAD",
    gitStatusSummary: summarizeStatus(
      (await environment.executeCommand("git status --porcelain")).stdout,
    ),
  };

  const agentPromise = createAgent(environment, config, {
    root,
    ctx,
    spill: { dir: spillSink.dir, write: spillSink.write },
    onToolActivity,
  });
  try {
    // Surface a missing API key (or any composition error) as a clean one-line
    // failure before the alternate screen takes over the terminal.
    await agentPromise;
  } catch (error) {
    processStderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    return EXIT_FAILURE;
  }

  let ticker: ReturnType<typeof setInterval> | undefined;
  let handleSigint: (() => void) | undefined;
  try {
    let quitResolve: (() => void) | undefined;
    const done = new Promise<void>((resolve) => {
      quitResolve = resolve;
    });

    const render = (event: ChatEvent): void => {
      if (event.type === "turn-usage") {
        turnTokens.ctx = event.usage.inputTokens;
        updateStatus();
        return;
      }
      if (event.type === "turn-queued") {
        queuedMessages.push({
          text: event.text,
          ...(event.transcriptText ? { transcriptText: event.transcriptText } : {}),
        });
        refreshProgress();
        updateStatus();
        return;
      }
      if (event.type === "turn-started") {
        if (queuedMessages[0]?.text === event.text) {
          queuedMessages.shift();
          refreshProgress();
        }
        interruptRequested = false;
        turnProducedOutput = false;
      }
      if (event.type === "turn-abort-requested") interruptRequested = true;
      if (event.type === "turn-dequeued") {
        const index = queuedMessages.findLastIndex((entry) => entry.text === event.text);
        if (index !== -1) queuedMessages.splice(index, 1);
        refreshProgress();
        screen?.restoreInput(event.restoreText ?? event.text);
      }
      if (event.type === "turn-finished") interruptRequested = false;
      // One seam lowers every transcript event to a semantic block + spacing.
      // User and assistant blocks separate with a blank line ("turn"); tool and
      // system lines pack tight ("none"). The empty-response notice fires only
      // when the turn showed nothing at all — otherwise the turn is
      // indistinguishable from a hang.
      const item = toTranscriptItem(event);
      if (item && screen && (item.kind !== "empty" || !turnProducedOutput)) {
        if (item.kind !== "user") turnProducedOutput = true;
        const { block, spacing } = renderTranscriptItem(item, screen.width());
        screen.printAbove(block, spacing);
      }
      updateStatus();
    };
    emitChatEvent = render;

    const contextSoftLimit = contextSoftLimitFromEnv();
    const chat: ChatSession = createChatSession({
      agent: agentPromise,
      ...(contextSoftLimit !== undefined ? { contextSoftLimit } : {}),
      onEvent: (event) => emitChatEvent?.(event),
    });

    const home = homedir();
    const rootDisplay = root.startsWith(home) ? `~${root.slice(home.length)}` : root;
    updateStatus = (): void => {
      if (!screen) return;
      const busy = chat.busy;
      const queued = queuedMessages.length;
      screen.setStatusLines(
        composeStatusSection(
          {
            root: rootDisplay,
            model: config.llm.model,
            usage: turnTokens,
            ...(contextSoftLimit !== undefined ? { contextSoftLimit } : {}),
          },
          screen.width(),
        ).map((text): UiTextLine => {
          const segs: UiSpan[] = [{ text, tone: "muted" }];
          if (interruptRequested)
            segs.push({
              text: `   Stopping safely…${queued ? ` · ${queued} queued` : ""}`,
              tone: "warning",
            });
          else if (busy)
            segs.push({ text: `   ${formatVuMeter(vuFrame)}  Esc interrupt`, tone: "accent" });
          return segs;
        }),
      );
    };

    // The tool sweep and busy meter animate on the fast frame. The screen skips
    // repaints when a section is unchanged, so idle ticks cost one comparison.
    ticker = setInterval(() => {
      vuFrame += 1;
      if (activeTools.size > 0) refreshProgress();
      updateStatus();
    }, 90);

    // OpenTUI is the only chat surface — a full-screen retained-mode renderer.
    screen = await createOpenTuiChatScreen({
      stdout: processStdout,
      callbacks: {
        onSubmit: (text: string) => {
          void chat.send(text);
          updateStatus();
        },
        onEscape: () => {
          // Escalation ladder: undo the newest pending intent first, then interrupt.
          if (chat.dequeue() !== null) return;
          chat.abort();
        },
        onQuit: () => quitResolve?.(),
      },
    });

    screen.start();
    refreshProgress();
    updateStatus();

    handleSigint = (): void => {
      if (chat.dequeue() !== null) return;
      if (!chat.abort()) quitResolve?.();
    };
    process.on("SIGINT", handleSigint);
    await done;
    return EXIT_SUCCESS;
  } finally {
    emitChatEvent = null;
    if (ticker) clearInterval(ticker);
    if (handleSigint) process.removeListener("SIGINT", handleSigint);
    screen?.stop();
    spillSink.close();
  }
}

const formatUnexpectedError = (error: unknown): string => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }

  return String(error);
};

export { formatChatEvent, truncateLineWithNotice } from "./lib/tui/chat-event-format";
export { composeProgressLines } from "./lib/tui/progress";
export { composeStatusSection, formatClock, type StatusSectionState } from "./lib/tui/status";

const main = async (): Promise<void> => {
  process.exitCode = await runGloriousCli(
    process.argv.slice(2),
    {
      version: COMMAND_VERSION,
      runChat: () => runGloriousChat(),
    },
    { stdout: processStdout, stderr: processStderr },
  );
};

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    processStderr.write(`${formatUnexpectedError(error)}\n`);
    process.exitCode = 1;
  }
}
