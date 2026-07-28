import type { Agent } from "../agent";
import type { ChatEvent } from "./events";

/**
 * The chat loop's core: one foreground turn at a time over an opaque message
 * continuation, with message queueing. Pure logic — no TTY, no process state;
 * the composition root injects the agent, and the screen renders the emitted
 * events.
 */

export interface ChatSessionDependencies {
  agent: Promise<Agent>;
  /** Request-context ceiling; old turns compact automatically at 75%. */
  contextSoftLimit?: number;
  onEvent?(event: ChatEvent): void | Promise<void>;
}

export interface ChatSession {
  readonly busy: boolean;
  /**
   * Submit a user message. Runs the turn now, or queues it when one is
   * already running (queued messages run in order). Resolves when this
   * message's turn has completed.
   */
  send(text: string, options?: { transcriptText?: string; restoreText?: string }): Promise<void>;
  /** Abort the running foreground turn. Returns false when idle. */
  abort(): boolean;
  /**
   * Remove the most recently queued message (LIFO — escape undoes the latest
   * intent) and resolve its `send()` promise. Returns the removed text, or
   * null when nothing is queued.
   */
  dequeue(): string | null;
}

export function createChatSession(deps: ChatSessionDependencies): ChatSession {
  let messages: unknown[] = [];
  let busy = false;
  let turnAbort: AbortController | null = null;
  const notices: string[] = [];
  const queue: Array<{
    text: string;
    transcriptText?: string;
    restoreText?: string;
    resolve: () => void;
  }> = [];

  const emit = (event: ChatEvent): void => {
    void deps.onEvent?.(event);
  };

  const runExchange = async (text: string, transcriptText?: string): Promise<void> => {
    turnAbort = new AbortController();
    const abort = turnAbort;
    emit({ type: "turn-started", text, ...(transcriptText ? { transcriptText } : {}) });

    const drained = notices.splice(0);
    const content = drained.length > 0 ? `${drained.join("\n")}\n\n${text}` : text;

    try {
      const agent = await deps.agent;
      // Stream each step's assistant text as it lands so intermediate prose (the
      // model talking between tool calls) is shown, not dropped in favour of only
      // the final text. `lastStreamed` dedups the final emit below.
      let lastStreamed = "";
      const result = await agent.generate(content, {
        abortSignal: abort.signal,
        onStep: (step) => {
          const stepText = step.text ?? "";
          if (stepText.trim().length > 0) {
            emit({ type: "assistant", text: stepText });
            lastStreamed = stepText;
          }
          for (const call of step.toolCalls) emit({ type: "tool-call", call });
          for (const toolResult of step.toolResults)
            emit({ type: "tool-result", result: toolResult });
          if (step.usage) emit({ type: "turn-usage", usage: step.usage });
        },
        messages,
      });
      messages = result.messages ?? messages;
      // The final text is normally the last step's — already streamed above, so
      // don't repeat it. Emit only to carry the step-limit notice, to show a
      // final text that wasn't streamed, or to surface an empty response.
      if (result.stepLimitReached) {
        const body = result.text.trim() && result.text !== lastStreamed ? result.text : "";
        emit({ type: "assistant", text: body, stepLimitReached: true });
      } else if (result.text.trim() && result.text !== lastStreamed) {
        emit({ type: "assistant", text: result.text });
      } else if (lastStreamed.trim().length === 0 && result.text.trim().length === 0) {
        emit({ type: "assistant", text: "" });
      }
      if (result.stepLimitReached)
        notices.push("[note] The previous turn stopped at the step limit before finishing.");
      const latestContext = result.steps.at(-1)?.usage?.inputTokens;
      const softLimit = deps.contextSoftLimit;
      if (softLimit && latestContext && latestContext >= softLimit * 0.75) {
        const compacted = agent.compactContinuation?.(messages) ?? messages;
        if (compacted !== messages) {
          messages = compacted;
          emit({ type: "notice", text: "Context compacted after reaching 75% of its soft limit." });
        }
      }
    } catch (error) {
      if (abort.signal.aborted) {
        emit({ type: "turn-aborted" });
        notices.push(`[note] The previous turn ("${text.slice(0, 60)}") was interrupted.`);
      } else {
        const message = error instanceof Error ? error.message : String(error);
        emit({ type: "turn-error", error: message });
        notices.push(
          `[note] The previous turn failed (${message.slice(0, 200)}) before completing. Its request was: "${text.slice(0, 2_000)}". If the user asks to retry or continue, act on that request.`,
        );
      }
    } finally {
      if (turnAbort === abort) turnAbort = null;
      emit({ type: "turn-finished" });
    }
  };

  const runTurn = async (text: string, transcriptText?: string): Promise<void> => {
    busy = true;
    try {
      await runExchange(text, transcriptText);
    } finally {
      busy = false;
      emit({ type: "submission-finished" });
    }
  };

  const drainQueue = async (): Promise<void> => {
    while (queue.length > 0 && !busy) {
      const next = queue.shift();
      if (!next) break;
      await runTurn(next.text, next.transcriptText);
      next.resolve();
    }
  };

  const send: ChatSession["send"] = async (text, options) => {
    const transcriptText = options?.transcriptText;
    const restoreText = options?.restoreText;
    if (busy) {
      emit({
        type: "turn-queued",
        text,
        ...(transcriptText ? { transcriptText } : {}),
        ...(restoreText ? { restoreText } : {}),
      });
      await new Promise<void>((resolve) => {
        queue.push({
          text,
          ...(transcriptText ? { transcriptText } : {}),
          ...(restoreText ? { restoreText } : {}),
          resolve,
        });
      });
      return;
    }
    await runTurn(text, transcriptText);
    await drainQueue();
  };

  return {
    get busy() {
      return busy;
    },

    send,

    abort() {
      if (!turnAbort) return false;
      if (!turnAbort.signal.aborted) {
        turnAbort.abort();
        emit({ type: "turn-abort-requested" });
      }
      return true;
    },

    dequeue() {
      const entry = queue.pop();
      if (!entry) return null;
      emit({
        type: "turn-dequeued",
        text: entry.text,
        ...(entry.restoreText ? { restoreText: entry.restoreText } : {}),
      });
      entry.resolve();
      return entry.text;
    },
  };
}
