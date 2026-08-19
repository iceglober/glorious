import type { ModelMessage } from "ai";
import { compactedPrompt, type SessionEvent } from "../../glorious-core/src/events";
import type { Agent, TurnPhase } from "./agent";
import { reminder } from "./prompt";
import { merge, newest, type Queued, type QueueKind, type QueueMode, take } from "./queue";
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
    // How much of each queue one delivery takes. Both default to one message at
    // a time, which is the setting that lets the model answer what you said
    // before it reads what you said next.
    steeringMode?: QueueMode;
    followUpMode?: QueueMode;
  },
) => {
  // A turn the app starts on the user's behalf is not something the user said,
  // so it carries its own label for the transcript rather than being echoed.
  type Delivery = { text: string; label: string | null };
  // Two queues, because the two kinds wait for different things: a follow-up
  // waits for the agent to run out of work, a steering message waits only for
  // the running turn to reach its next step boundary. One list with a flag on
  // each item would have to be scanned for the right kind on both paths, and
  // the running item used to sit at index 0 of that list — which is why `queued`
  // was a slice(1) that every caller had to remember.
  const followUps: Queued[] = [];
  const steering: Queued[] = [];
  let running: Delivery | null = null;
  // Esc stops the turn and holds the queue with it. Without this the message
  // you queued two minutes ago fires into whatever state the interrupt left
  // behind, which is the opposite of what pressing stop meant. Sending anything
  // releases it; so does calling release().
  let held = false;
  let draining = false;
  let ids = 0;
  const steeringMode = wiring.steeringMode ?? "one-at-a-time";
  const followUpMode = wiring.followUpMode ?? "one-at-a-time";
  // Anything in flight or waiting for its turn. Compaction and clearing both
  // refuse while this is true: they rewrite the history a queued message is
  // about to be answered against.
  const working = (): boolean => running !== null || followUps.length > 0 || steering.length > 0;
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

  const turn = async ({ text, label }: Delivery): Promise<void> => {
    const stop = new AbortController();
    live = stop;
    // Steering messages this attempt has taken out of the queue. A dropped
    // stream is re-sent from the first step, so anything the attempt that died
    // took has to go back — otherwise it was delivered only to a request that
    // was thrown away, and the user watches their message vanish.
    let inFlight: Queued[] = [];
    // Ids, not messages: a restored message is delivered a second time and the
    // transcript already showed it the first time.
    const said = new Set<number>();
    // Asked at every step boundary. Empty is the normal answer and costs a
    // function call; when it is not, the text joins the messages for the next
    // step, so the model reads it before it chooses its next action.
    const onSteer = (): readonly string[] => {
      if (steering.length === 0) return [];
      const { taken, rest } = take(steering, steeringMode);
      steering.length = 0;
      steering.push(...rest);
      inFlight = [...inFlight, ...taken];
      for (const item of taken) {
        if (said.has(item.id)) continue;
        said.add(item.id);
        announce({ type: "user", text: item.label ?? item.text, steer: true });
      }
      return taken.map((item) => item.text);
    };
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
        onSteer,
        onRetry: (attempt, why) => {
          // Back to the front of the queue, in the order they were taken, so
          // the re-sent attempt delivers them at its own first step boundary.
          steering.unshift(...inFlight);
          inFlight = [];
          announce({
            type: "notice",
            text: `(connection dropped — re-sending, attempt ${attempt + 1}: ${why})`,
          });
        },
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
    // A steering message that never met a step boundary — the turn answered in
    // one step, or it was interrupted — is still something the user said. It
    // becomes its own turn rather than being dropped, which is what "queued"
    // has to mean for the queue to be worth anything. Ahead of the follow-ups,
    // because it was meant for sooner than they were.
    if (steering.length > 0) followUps.unshift(...steering.splice(0));
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
    if (working()) return { outcome: "busy" };
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
    while (!held && followUps.length > 0) {
      const { taken, rest } = take(followUps, followUpMode);
      followUps.length = 0;
      followUps.push(...rest);
      running = merge(taken);
      await turn(running);
      running = null;
    }
  };

  // Re-entrant on purpose: sending during a turn only has to add to the queue,
  // because the loop already running will reach it. The old shape started the
  // drain when the queue went from empty to one, which only worked because the
  // running item stayed in the queue.
  const pump = (): void => {
    if (draining || held) return;
    draining = true;
    void drain().finally(() => {
      draining = false;
    });
  };

  return {
    get busy(): boolean {
      // A held queue is not busy: nothing is going to happen to it until you
      // say so, and reporting otherwise puts an "Esc interrupt" row on screen
      // over a session that is sitting still.
      return running !== null || (!held && followUps.length > 0);
    },
    // Steering first, because that is the order they will be delivered in.
    get queued(): readonly Queued[] {
      return [...steering, ...followUps];
    },
    // Whether Esc has stopped the queue and there is something in it to hold.
    get held(): boolean {
      return held && (steering.length > 0 || followUps.length > 0);
    },
    // `label` is what the transcript shows. A slash command expands into a body
    // far larger than what was typed — echoing that back as the user's own
    // words buries the session under it.
    // Driven by the frame tick so a burst of deltas costs one repaint.
    flush: flushDeltas,
    // A follow-up waits for the agent to finish everything; a steering message
    // joins the turn that is already running, at its next step boundary. With
    // nothing running there is nothing to steer, so it simply becomes the turn
    // — waiting for a boundary that will never come is not a kinder failure.
    send: (text: string, label: string | null = null, kind: QueueKind = "follow-up"): void => {
      // Sending is also how you say "go" after Esc held the queue. Starting
      // work again is not something anyone does by accident, so it does not
      // need a key of its own.
      held = false;
      ids += 1;
      const item: Queued = { id: ids, text, label, kind };
      if (kind === "steer" && running !== null) steering.push(item);
      else followUps.push(item);
      pump();
    },
    // Let a held queue run again without adding to it. Enter on an empty
    // composer is what reaches this.
    release: (): boolean => {
      if (!held) return false;
      held = false;
      pump();
      return working();
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
      if (working()) return "busy";
      if (history.length === 0) return "empty";
      history = [];
      note = "";
      return "cleared";
    },
    // Stopping the work stops the queue with it. What was waiting keeps
    // waiting: Alt+Up takes it back to the composer, sending anything releases
    // it. This used to pull a queued message into the composer instead of
    // stopping the turn, so Esc during a turn looked like it did nothing.
    abort: (): boolean => {
      const stopped = live !== null;
      live?.abort();
      held = steering.length > 0 || followUps.length > 0;
      return stopped || held;
    },
    // Alt+Up. The newest waiting message leaves the queue and is handed back
    // for the composer, which is why there is no separate rescind and no
    // separate edit: taking it back is both. The label is what comes back, not
    // the text — restoring the expanded body of a slash command would put a
    // page of prompt in the composer where "/review" was typed.
    unqueue: (): Queued | null => {
      const item = newest(steering, followUps);
      if (item === null) return null;
      for (const queue of [steering, followUps]) {
        const at = queue.indexOf(item);
        if (at >= 0) queue.splice(at, 1);
      }
      return item;
    },
  };
};
