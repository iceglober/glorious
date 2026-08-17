import type { ModelMessage } from "ai";
import type { Agent } from "./agent";
import type { SessionEvent } from "./events";
import { reminder } from "./prompt";
import { errorText } from "./render";
import type { ToolEvent } from "./tools";

export type ChatSignal =
  | { type: "tool"; tool: ToolEvent }
  | { type: "empty" }
  | { type: "dequeued"; text: string }
  // live text, painted and then replaced by the durable assistant event
  | { type: "delta"; kind: "text" | "reasoning"; text: string }
  | { type: "sealed" }
  // which part of the model call is in flight, for the wave's sub-status
  | { type: "phase"; name: "sending" | "waiting" | "thinking" | "writing" | null }
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

  const onTool = (started: Map<number, number>, tool: ToolEvent): void => {
    signal({ type: "tool", tool });
    if (tool.phase === "start") {
      started.set(tool.id, Date.now());
      return;
    }
    const since = started.get(tool.id);
    started.delete(tool.id);
    announce({
      type: "tool",
      name: tool.name,
      detail: tool.detail,
      elapsedMs: since === undefined ? 0 : Date.now() - since,
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
    let prompt = note === "" ? text : `${note}\n\n${text}`;
    note = "";
    const added = await wiring.onBeforeRequest?.(prompt, history.length);
    if (added !== undefined && added !== "") prompt = `${prompt}\n\n${added}`;
    const started = new Map<number, number>();
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
        onReasoningEnd: ({ text, elapsedMs }) => {
          flushDeltas();
          signal({ type: "sealed" });
          announce({ type: "reasoning", text, elapsedMs });
        },
        onTool: (tool) => onTool(started, tool),
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
