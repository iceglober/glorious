import type { ModelMessage } from "ai";
import type { Agent, TurnPhase } from "./agent";
import { errorText } from "./display";
import { compactedPrompt, type SessionEvent } from "./events";
import { reminder } from "./preamble";
import { merge, newest, type Queued, type QueueKind, type QueueMode, take } from "./queue";
import type { ToolEvent } from "./toolkit";

// Everything a turn reports, plus the one thing only the chat can be doing.
export type ChatPhase = TurnPhase | "compacting" | null;

/** Result of a manual or automatic conversation compaction. */
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
    onPreflight?: (prompt: string, history: readonly ModelMessage[]) => Promise<void>;
    onBeforeRequest?: (prompt: string, messages: number) => Promise<string | undefined>;
    history?: ModelMessage[];
    // The messages a compaction replaced, at the moment the brief takes their
    // place. Chat does not know where they should live; whoever wires it does.
    onCompacted?: (dropped: readonly ModelMessage[], summary: string) => void;
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
  // A brief that finished while a turn was running. `compact` rewrites the
  // prefix, a turn only appends, so the two do not conflict: the brief is held
  // and spliced in once the turn has landed. Before this the turn's
  // `history = done.messages` overwrote the compaction outright, so a
  // compaction the user had waited minutes for was computed, paid for, and
  // thrown away the moment they typed.
  let heldBrief: { summary: string; cut: number; dropped: ModelMessage[] } | null = null;
  // Compaction's own controller. It used to share `live` with the turn, which
  // was fine while the two could not overlap: now that a brief is written in
  // the background while a turn runs, sharing it meant whichever finished first
  // nulled the other's handle, and Esc stopped one of them at random.
  let compactStop: AbortController | null = null;

  // Splice a held brief into the prefix. Safe because a turn only appends: the
  // messages below `cut` are the same ones the summary was made from, whatever
  // has been added after them.
  const applyHeldBrief = (): void => {
    if (heldBrief === null) return;
    const { summary, cut, dropped } = heldBrief;
    heldBrief = null;
    // The brief describes `history[0..cut]`. If the history is now shorter than
    // that, it is not the conversation the summary was made from and splicing
    // would delete everything after the cut rather than replace what came
    // before it. Dropping the brief costs one summary; the alternative costs
    // the conversation.
    if (history.length < cut) return;
    history = [{ role: "user", content: compactedPrompt(summary) }, ...history.slice(cut)];
    announce({ type: "compacted", summary, dropped: cut });
    wiring.onCompacted?.(dropped, summary);
  };

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
    // The reminder trails what was asked. It led, once, and a model that had
    // just been interrupted answered the reminder instead of the request —
    // replying "Retried successfully" to a page of new instructions. What the
    // user typed is the turn; the reminder is context about the last one.
    let prompt = note === "" ? text : `${text}\n\n${note}`;
    note = "";
    await wiring.onPreflight?.(prompt, history);
    if (label === null) {
      announce({ type: "user", text });
    } else {
      announce({ type: "notice", text: label });
    }
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
            text: `(connection dropped, re-sending. attempt ${attempt + 1}: ${why})`,
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
      applyHeldBrief();
      if (done.text.trim() !== "" && done.text !== spoken) {
        spoken = done.text;
        announce({ type: "assistant", text: spoken });
      }
      if (spoken === "") signal({ type: "empty" });
      // The turn stopped short of the window rather than being refused by it.
      // Saying so and compacting here is the difference between a pause and
      // "Your input exceeds the context window of this model", which is what a
      // turn that grew past the window inside itself used to get.
      if (done.stoppedForContext) {
        note = reminder("Your last turn stopped early to make room in the context window.");
        announce({
          type: "notice",
          text: '(compacting to make room: send "continue" to resume)',
        });
      }
      if (done.stoppedAtStepLimit) {
        note = reminder("Your last turn ran out of steps and stopped before finishing.");
        announce({ type: "notice", text: '(step limit reached: send "continue" to resume)' });
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
  // Where a cut may land without orphaning a tool result from its call: on a
  // user message, or on an assistant message that follows a tool result, which
  // is the start of a new step. The second is what lets one long agentic turn
  // be compacted on its own. With only user boundaries, a conversation that was
  // a single turn of tool calls had no cut point above zero at any size, and
  // "compact when the window fills" quietly never did.
  const boundary = (messages: readonly ModelMessage[], at: number): boolean =>
    messages[at].role === "user" ||
    (messages[at].role === "assistant" && messages[at - 1]?.role === "tool");

  const cutPoint = (messages: readonly ModelMessage[], keep: number, force: boolean): number => {
    let carried = 0;
    let lastBoundary = 0;
    for (let at = messages.length - 1; at > 0; at -= 1) {
      carried += weigh(messages[at]);
      if (!boundary(messages, at)) continue;
      lastBoundary = at;
      if (carried >= keep) return at;
    }
    // Asked for directly, nothing is big enough to satisfy `keep`, and there is
    // more than one turn: compact what there is and keep the last turn. Without
    // this `/compact` declines on every conversation short of the automatic
    // threshold, which is every conversation anyone types it into.
    return force ? lastBoundary : 0;
  };

  const compact = async (
    instruction: string,
    keep: number,
    force = false,
    suppliedSummary?: string,
  ): Promise<Compaction> => {
    // One at a time, and not while a finished brief is still waiting for a
    // turn to land: a second one would be written against the same prefix and
    // simply replace the first, which is a wasted summary either way.
    if (compacting || heldBrief !== null) return { outcome: "busy" };
    // Whether anyone is watching. Idle, the summary is the only thing happening
    // and the status row counts it out. Mid-turn it is background work: the
    // turn keeps the phase row and the brief lands when the turn does.
    const foreground = !working();
    // A snapshot, because the summary is written from it while a turn may be
    // appending to the live one. A turn only appends, so `snapshot[0..cut]`
    // is still `history[0..cut]` when the brief is ready to go in.
    const snapshot = history.slice();
    const cut = cutPoint(snapshot, keep, force);
    if (cut === 0) return { outcome: "too-short" };
    compacting = true;
    const stop = new AbortController();
    compactStop = stop;
    if (foreground) signal({ type: "phase", name: "compacting" });
    try {
      const dropped = snapshot.slice(0, cut);
      const summary = suppliedSummary ?? (await agent.summarise(dropped, instruction, stop.signal));
      if (summary === "") return { outcome: "failed", error: "the summary came back empty" };
      heldBrief = { summary, cut, dropped };
      if (working()) return { outcome: "compacted", dropped: cut, kept: history.length - cut };
      applyHeldBrief();
      return { outcome: "compacted", dropped: cut, kept: history.length - 1 };
    } catch (thrown) {
      return {
        outcome: "failed",
        error: stop.signal.aborted ? "interrupted" : errorText(thrown),
      };
    } finally {
      compacting = false;
      compactStop = null;
      if (foreground) signal({ type: "phase", name: null });
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
    get history(): readonly ModelMessage[] {
      return history;
    },
    replaceHistory: (messages: readonly ModelMessage[]): boolean => {
      if (working()) return false;
      history = [...messages];
      note = "";
      return true;
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
      // The turn is what the user is watching. A brief being written in the
      // background is invisible and cheap to leave alone; one in the foreground
      // is the only thing on screen, and Esc means it.
      const target = live ?? compactStop;
      const stopped = target !== null;
      target?.abort();
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
