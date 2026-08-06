import type { ModelMessage } from "ai";
import type { Agent } from "./agent";
import { errorText } from "./render";
import type { ToolEvent } from "./tools";

export type ChatEvent =
  | { type: "user"; text: string }
  | { type: "assistant"; text: string }
  | { type: "tool"; tool: ToolEvent }
  | { type: "empty" }
  | { type: "notice"; text: string }
  | { type: "error"; text: string }
  | { type: "usage"; tokens: number; cached: number }
  | { type: "dequeued"; text: string }
  | { type: "idle" };

const NOTE_CHARS = 160;

export const createChat = (
  agent: Agent,
  onEvent: (event: ChatEvent) => void,
  options: { history?: ModelMessage[]; onHistory?: (history: ModelMessage[]) => void } = {},
) => {
  const queue: string[] = [];
  let history: ModelMessage[] = options.history?.slice() ?? [];
  let live: AbortController | null = null;
  let note = "";

  const announce = (event: ChatEvent): void => {
    try {
      onEvent(event);
    } catch {}
  };

  const turn = async (text: string): Promise<void> => {
    const stop = new AbortController();
    live = stop;
    announce({ type: "user", text });
    const prompt = note === "" ? text : `${note}\n\n${text}`;
    note = "";
    let spoken = "";
    let failed = "";
    const done = await agent
      .run(prompt, history, {
        signal: stop.signal,
        onTool: (tool) => announce({ type: "tool", tool }),
        onStep: (step) => {
          announce({ type: "usage", tokens: step.contextTokens, cached: step.cachedTokens });
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
      note = `[note] The user interrupted your last turn, which was answering: "${asked}".`;
      announce({ type: "notice", text: "(interrupted)" });
    } else if (done === null) {
      note = `[note] Your last turn on "${asked}" failed: ${failed.slice(0, NOTE_CHARS)}.`;
      announce({ type: "error", text: failed });
    } else {
      history = done.messages;
      options.onHistory?.(history);
      if (done.text.trim() !== "" && done.text !== spoken) {
        spoken = done.text;
        announce({ type: "assistant", text: spoken });
      }
      if (spoken === "") announce({ type: "empty" });
      if (done.stoppedAtStepLimit) {
        note = "[note] Your last turn ran out of steps and stopped before finishing.";
        announce({ type: "notice", text: '(step limit reached — send "continue" to resume)' });
      }
    }
    announce({ type: "idle" });
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
      announce({ type: "dequeued", text: dropped });
      return dropped;
    },
  };
};
