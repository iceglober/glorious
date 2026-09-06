import type { QueueMode } from "./index";
// The two ways a message can wait. They differ in when it reaches the model,
// not in what it says:
//
//   follow-up — becomes its own turn once the agent has finished all its work.
//   steer     — joins the turn that is already running, at the next step
//               boundary, so the model sees it before it takes another action.
//
// Enter queues a follow-up because that is the safe default: it can never
// change what the running turn does, so pressing it while something is in
// flight has no way to make things worse. Steering is the deliberate act, and
// it carries a modifier.
export type QueueKind = "steer" | "follow-up";

// One waiting message. `label` is what the transcript shows in place of `text`
// — a slash command expands into a body far larger than what was typed, and
// echoing that back as the user's own words buries the session under it.
export type Queued = {
  id: number;
  text: string;
  label: string | null;
  kind: QueueKind;
};

// How much of a queue one delivery takes.
//
//   one-at-a-time — the oldest waiting message, and the rest keep waiting.
//   all           — everything waiting, joined into a single delivery.
//
// one-at-a-time is the default for both kinds because it is the one that lets
// the model answer what you said before it reads what you said next. `all` is
// for when the messages are one thought split across three Enters.
export type { QueueMode } from "./index";

// What comes off the front of the queue for one delivery, and what is left
// behind. Returning both halves rather than mutating keeps this testable
// without a chat around it, which is the whole reason it lives here.
export const take = <T>(waiting: readonly T[], mode: QueueMode): { taken: T[]; rest: T[] } =>
  mode === "all"
    ? { taken: waiting.slice(), rest: [] }
    : { taken: waiting.slice(0, 1), rest: waiting.slice(1) };

// Several waiting messages becoming one delivery. The label survives only if
// something in the batch had one: a batch of plain typed messages is still just
// what the user typed, and giving it a synthetic label would put a second copy
// of the text in the transcript.
export const merge = (batch: readonly Queued[]): { text: string; label: string | null } => ({
  text: batch.map((item) => item.text).join("\n\n"),
  label: batch.every((item) => item.label === null)
    ? null
    : batch.map((item) => item.label ?? item.text).join("\n\n"),
});

// Alt+Up, once. The newest waiting message leaves the queue and goes back to
// the composer — which is why there is no separate rescind and no separate
// edit. Taking it back is both: retype it and press Enter, or clear the line
// and it is gone.
//
// Newest across both queues rather than steering-first, so Alt+Up always undoes
// the last thing you pressed Enter on. A rule that depended on which kind you
// queued would mean looking at the rows to predict what the key does, and the
// whole point of the key is that you do not have to.
export const newest = (...queues: ReadonlyArray<readonly Queued[]>): Queued | null =>
  // Ids only ever increase, so within one queue the newest is the last one, and
  // the newest overall is the newest of those tails.
  queues
    .flatMap((queue) => queue.at(-1) ?? [])
    .reduce<Queued | null>(
      (best, item) => (best === null || item.id > best.id ? item : best),
      null,
    );
