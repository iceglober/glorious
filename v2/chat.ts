import type { ModelMessage } from "ai";
import type { Agent, TurnPhase } from "./agent";
import { compactedPrompt, type SessionEvent } from "./events";
import { reminder } from "./prompt";
import { errorText } from "./render";
import type { ToolEvent } from "./tools";

// Everything a turn reports, plus the one thing only the chat can be doing.
export type ChatPhase = TurnPhase | "compacting" | null;

export type Compaction =
  | { outcome: "compacted"; dropped: number; kept: number }
  | { outcome: "busy" }
  | { outcome: "too-short" }
  | { outcome: "failed"; error: string };

export type ChatSignal =
  | { type: "tool"; tool: ToolEvent }
  | { type: "empty" }
  | { type: "dequeued"; text: string }
  // live text, painted and then replaced by the durable assistant event
  | { type: "delta"; kind: "text" | "reasoning"; text: string }
  | { type: "sealed" }
  // which part of the model call is in flight, for the wave's sub-status
  | { type: "phase"; name: ChatPhase }
  | { type: "idle" };

const NOTE_CHARS = 160;

export const createChat = (
  agent: Agent,
  wiring: {
    onEvent: (event: SessionEvent) => void;
    onSignal: (signal: ChatSignal) => void;
    // Fires before the model is called. A string is appended to this turn's
    // message, which is how an extension injects context for one turn only.
    onBeforeRequest?: (prompt: string, messages: number) => Promise<string | undefined>;
    history?: ModelMessage[];
  },
) => {
  // A turn the app starts on the user's behalf is not something the user said,
  // so it carries its own label for the transcript rather than being echoed.
  type Pending = { text: string; label: string | null };
  const queue: Pending[] = [];
  let history: ModelMessage[] = wiring.history?.slice() ?? [];
  let live: AbortController | null = null;
  let note = "";
  let compacting = false;

  const announce = (event: SessionEvent): void => {
    try {
      wiring.onEvent(event);
    } catch {}
  };

  const signal = (value: ChatSignal): void => {
    try {
      wiring.onSignal(value);
    } catch {}
  };

  // The elapsed time arrives on the event, measured where the call ran. This
  // used to pair start with end here and subtract, which meant the transcript
  // and anything else reading it could disagree about the same call.
  const onTool = (tool: ToolEvent): void => {
    signal({ type: "tool", tool });
    if (tool.phase === "start") return;
    announce({
      type: "tool",
      name: tool.name,
      detail: tool.detail,
      elapsedMs: tool.elapsedMs,
      ok: tool.ok,
      input: tool.input,
      result: tool.result,
    });
  };

  let pending: { kind: "text" | "reasoning"; text: string } = { kind: "text", text: "" };

  const flushDeltas = (): void => {
    if (pending.text === "") return;
    const { kind, text } = pending;
    pending = { kind, text: "" };
    signal({ type: "delta", kind, text });
  };

  const turn = async ({ text, label }: Pending): Promise<void> => {
    const stop = new AbortController();
    live = stop;
    if (label === null) {
      announce({ type: "user", text });
    } else {
      announce({ type: "notice", text: label });
    }
    // The reminder trails what was asked. It led, once, and a model that had
    // just been interrupted answered the reminder instead of the request —
    // replying "Retried successfully" to a page of new instructions. What the
    // user typed is the turn; the reminder is context about the last one.
    let prompt = note === "" ? text : `${text}\n\n${note}`;
    note = "";
    const added = await wiring.onBeforeRequest?.(prompt, history.length);
    if (added !== undefined && added !== "") prompt = `${prompt}\n\n${added}`;
    const before = history.length;
    let spoken = "";
    let failed = "";
    const done = await agent
      .run(prompt, history, {
        signal: stop.signal,
        // Deltas arrive far faster than the repaint tick, so they accumulate here
        // and are flushed by flushDeltas() on the frame — never one paint per
        // delta.
        onDelta: ({ kind, text }) => {
          if (kind !== pending.kind) flushDeltas();
          pending = { kind, text: pending.text + text };
        },
        onPhase: (name) => signal({ type: "phase", name }),
        onRetry: (attempt, why) =>
          announce({
            type: "notice",
            text: `(connection dropped — re-sending, attempt ${attempt + 1}: ${why})`,
          }),
        onReasoningEnd: ({ text, elapsedMs }) => {
          flushDeltas();
          signal({ type: "sealed" });
          announce({ type: "reasoning", text, elapsedMs });
        },
        onTool,
        onStep: (step) => {
          // the step's complete text is about to be announced; anything still
          // buffered belongs to it, not to the next step
          flushDeltas();
          announce({
            type: "usage",
            tokens: step.contextTokens,
            cached: step.cachedTokens,
            input: step.contextTokens,
            output: step.outputTokens,
            cost: step.cost,
          });
          if (step.text.trim() === "") return;
          spoken = step.text;
          announce({ type: "assistant", text: spoken });
        },
      })
      .catch((thrown: unknown) => {
        failed = errorText(thrown);
        return null;
      });
    live = null;
    const asked = text.slice(0, NOTE_CHARS);
    if (done === null && stop.signal.aborted) {
      note = reminder(`The user interrupted your last turn, which was answering: "${asked}".`);
      announce({ type: "notice", text: "(interrupted)" });
    } else if (done === null) {
      note = reminder(`Your last turn on "${asked}" failed: ${failed.slice(0, NOTE_CHARS)}.`);
      announce({ type: "error", text: failed });
    } else {
      history = done.messages;
      announce({ type: "turn", messages: done.messages.slice(before) });
      if (done.text.trim() !== "" && done.text !== spoken) {
        spoken = done.text;
        announce({ type: "assistant", text: spoken });
      }
      if (spoken === "") signal({ type: "empty" });
      if (done.stoppedAtStepLimit) {
        note = reminder("Your last turn ran out of steps and stopped before finishing.");
        announce({ type: "notice", text: '(step limit reached — send "continue" to resume)' });
      }
    }
    signal({ type: "idle" });
  };

  // Roughly four characters to a token. Good enough to choose a cut point;
  // the provider's own count is what decides whether to cut at all.
  const weigh = (message: ModelMessage): number => JSON.stringify(message).length / 4;

  // The cut has to land on a user message. A tool result separated from the
  // call it answers is an invalid request, so cutting anywhere is not an option
  // — this walks back to the nearest boundary that keeps at least `keep` tokens.
  const cutPoint = (keep: number, force: boolean): number => {
    let carried = 0;
    let lastBoundary = 0;
    for (let at = history.length - 1; at > 0; at -= 1) {
      carried += weigh(history[at]);
      if (history[at].role !== "user") continue;
      lastBoundary = at;
      if (carried >= keep) return at;
    }
    // Asked for directly, nothing is big enough to satisfy `keep`, and there is
    // more than one turn: compact what there is and keep the last turn. Without
    // this `/compact` declines on every conversation short of the automatic
    // threshold, which is every conversation anyone types it into.
    return force ? lastBoundary : 0;
  };

  const compact = async (instruction: string, keep: number, force = false): Promise<Compaction> => {
    if (queue.length > 0) return { outcome: "busy" };
    const cut = cutPoint(keep, force);
    if (cut === 0) return { outcome: "too-short" };
    compacting = true;
    // Summarising a long conversation is a model call that can run for minutes.
    // It rides the same phase signal a turn does, so the status row counts it
    // out instead of the screen sitting still — and the same controller, so Esc
    // stops it like anything else. A turn cannot be running: `busy` above.
    const stop = new AbortController();
    live = stop;
    signal({ type: "phase", name: "compacting" });
    try {
      const summary = await agent.summarise(history.slice(0, cut), instruction, stop.signal);
      if (summary === "") return { outcome: "failed", error: "the summary came back empty" };
      const dropped = cut;
      history = [{ role: "user", content: compactedPrompt(summary) }, ...history.slice(cut)];
      announce({ type: "compacted", summary, dropped });
      return { outcome: "compacted", dropped, kept: history.length - 1 };
    } catch (thrown) {
      return {
        outcome: "failed",
        error: stop.signal.aborted ? "interrupted" : errorText(thrown),
      };
    } finally {
      compacting = false;
      live = null;
      signal({ type: "phase", name: null });
    }
  };

  const drain = async (): Promise<void> => {
    while (queue.length > 0) {
      await turn(queue[0]);
      queue.shift();
    }
  };

  return {
    get busy(): boolean {
      return queue.length > 0;
    },
    get queued(): readonly string[] {
      return queue.slice(1).map((item) => item.label ?? item.text);
    },
    // `label` is what the transcript shows. A slash command expands into a body
    // far larger than what was typed — echoing that back as the user's own
    // words buries the session under it.
    // Driven by the frame tick so a burst of deltas costs one repaint.
    flush: flushDeltas,
    // `steer` lands the message next rather than last: the running turn is
    // untouched, but everything already waiting yields to it.
    send: (text: string, label: string | null = null, steer = false): void => {
      if (steer && queue.length > 1) queue.splice(1, 0, { text, label });
      else queue.push({ text, label });
      if (queue.length === 1) void drain();
    },
    // Refused mid-turn on purpose: the running request already holds its own
    // copy of the messages, and when it lands it overwrites history with the
    // full set — so a clear during a turn would silently undo itself.
    // Summarise the older part of the conversation and carry the brief forward.
    // This necessarily invalidates the prompt cache — the prefix it was keyed on
    // no longer exists — which is a one-off cost that buys the session's life.
    compact,
    get compacting(): boolean {
      return compacting;
    },
    clear: (): "cleared" | "busy" | "empty" => {
      if (queue.length > 0) return "busy";
      if (history.length === 0) return "empty";
      history = [];
      note = "";
      return "cleared";
    },
    abort: (): boolean => {
      live?.abort();
      return live !== null;
    },
    dequeue: (): string | null => {
      if (queue.length < 2) return null;
      const [dropped] = queue.splice(-1);
      const text = dropped.label ?? dropped.text;
      signal({ type: "dequeued", text });
      return text;
    },
  };
};
