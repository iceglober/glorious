import type { ModelMessage } from "ai";
import type { Agent } from "./agent";
import type { SessionEvent } from "./events";
import { DEFAULT_MODE } from "./modes";
import { implementPrompt, planNudge, reminder } from "./prompt";
import { errorText } from "./render";
import type { ToolEvent } from "./tools";

export type ChatSignal =
  | { type: "tool"; tool: ToolEvent }
  | { type: "empty" }
  | { type: "dequeued"; text: string }
  | { type: "mode" }
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
  // A turn the app starts on the user's behalf is not something the user said,
  // so it carries its own label for the transcript rather than being echoed.
  type Pending = { text: string; label: string | null };
  const queue: Pending[] = [];
  let history: ModelMessage[] = wiring.history?.slice() ?? [];
  let live: AbortController | null = null;
  let note = "";
  let lastAsk = "";
  let approved: { plan: string; files: string[]; fresh: boolean } | null = null;
  let nudged = false;

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
    // A subagent's tools stay out of the transcript; they are still signalled,
    // so the live view can group and show them on demand.
    if (tool.origin !== undefined) return;
    announce({
      type: "tool",
      name: tool.name,
      detail: tool.detail,
      elapsedMs: since === undefined ? 0 : Date.now() - since,
      ok: tool.ok,
    });
  };

  const turn = async ({ text, label }: Pending): Promise<void> => {
    const stop = new AbortController();
    live = stop;
    if (label === null) {
      lastAsk = text;
      announce({ type: "user", text });
    } else {
      announce({ type: "notice", text: label });
    }
    const prompt = note === "" ? text : `${note}\n\n${text}`;
    note = "";
    let presented = false;
    const started = new Map<number, number>();
    const before = history.length;
    let spoken = "";
    let failed = "";
    const done = await agent
      .run(prompt, history, {
        signal: stop.signal,
        onTool: (tool) => {
          if (tool.name === "present_plan") presented = true;
          onTool(started, tool);
        },
        onStep: (step) => {
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
      // Plan mode is supposed to end by presenting a plan. Instruction alone has
      // a measured failure record here, so a turn that ends without one is asked
      // again — once, so a model that will not comply cannot loop.
      if (agent.mode().readOnly && !presented && approved === null && !nudged) {
        nudged = true;
        queue.push({ text: planNudge, label: null });
      }
    }
    signal({ type: "idle" });
  };

  const drain = async (): Promise<void> => {
    while (queue.length > 0) {
      await turn(queue[0]);
      queue.shift();
      if (approved === null) continue;
      const plan = approved;
      approved = null;
      nudged = false;
      // Ordered so a resumed session folds the same context the live one has:
      // the clear lands before the turn it is meant to precede.
      if (plan.fresh) {
        history = [];
        announce({ type: "cleared", reason: "plan approved" });
        announce({ type: "notice", text: "(context cleared — carrying the plan forward)" });
      }
      agent.setMode(DEFAULT_MODE);
      signal({ type: "mode" });
      queue.push({
        text: implementPrompt(plan.plan, plan.files, lastAsk),
        label: "(implementing the approved plan)",
      });
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
    send: (text: string, label: string | null = null): void => {
      queue.push({ text, label });
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
      lastAsk = "";
      return "cleared";
    },
    // Recorded during the turn, acted on once it ends: the in-flight request
    // already has its messages, so mode and context can only change at a
    // boundary.
    planApproved: (plan: string, files: string[], fresh: boolean): void => {
      approved = { plan, files, fresh };
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
