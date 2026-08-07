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
  | { type: "idle" };

const NOTE_CHARS = 160;

export const createChat = (
  agent: Agent,
  wiring: {
    onEvent: (event: SessionEvent) => void;
    onSignal: (signal: ChatSignal) => void;
    history?: ModelMessage[];
  },
) => {
  const queue: string[] = [];
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
    });
  };

  const turn = async (text: string): Promise<void> => {
    const stop = new AbortController();
    live = stop;
    announce({ type: "user", text });
    const prompt = note === "" ? text : `${note}\n\n${text}`;
    note = "";
    const started = new Map<number, number>();
    const before = history.length;
    let spoken = "";
    let failed = "";
    const done = await agent
      .run(prompt, history, {
        signal: stop.signal,
        onTool: (tool) => onTool(started, tool),
        onStep: (step) => {
          announce({
            type: "usage",
            tokens: step.contextTokens,
            cached: step.cachedTokens,
            input: step.contextTokens,
            output: step.outputTokens,
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
      return queue.slice(1);
    },
    send: (text: string): void => {
      queue.push(text);
      if (queue.length === 1) void drain();
    },
    abort: (): boolean => {
      live?.abort();
      return live !== null;
    },
    dequeue: (): string | null => {
      if (queue.length < 2) return null;
      const [dropped] = queue.splice(-1);
      signal({ type: "dequeued", text: dropped });
      return dropped;
    },
  };
};
