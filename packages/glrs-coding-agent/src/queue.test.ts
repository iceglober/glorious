import { describe, expect, test } from "bun:test";
import { isQueueMode, QUEUE_MODES } from "../../glrs-core/src";
import { merge, newest, type Queued, take } from "./queue";

const at = (id: number, text: string, kind: Queued["kind"] = "follow-up"): Queued => ({
  id,
  text,
  label: null,
  kind,
});

describe("how much of a queue one delivery takes", () => {
  test("one-at-a-time leaves the rest waiting", () => {
    const { taken, rest } = take([at(1, "a"), at(2, "b"), at(3, "c")], "one-at-a-time");
    expect(taken.map((item) => item.text)).toEqual(["a"]);
    expect(rest.map((item) => item.text)).toEqual(["b", "c"]);
  });

  test("all takes everything and leaves nothing", () => {
    const { taken, rest } = take([at(1, "a"), at(2, "b")], "all");
    expect(taken.map((item) => item.text)).toEqual(["a", "b"]);
    expect(rest).toEqual([]);
  });

  test("an empty queue yields an empty delivery under either mode", () => {
    for (const mode of ["one-at-a-time", "all"] as const)
      expect(take([], mode)).toEqual({ taken: [], rest: [] });
  });

  // The queue is not mutated in place, so a caller that keeps the old array
  // around is not silently holding a changed one.
  test("neither half aliases the queue it came from", () => {
    const waiting = [at(1, "a"), at(2, "b")];
    const { taken, rest } = take(waiting, "one-at-a-time");
    taken.push(at(9, "x"));
    rest.push(at(9, "x"));
    expect(waiting).toHaveLength(2);
  });
});

describe("several waiting messages becoming one", () => {
  test("the texts join with a blank line between them", () => {
    expect(merge([at(1, "run the tests"), at(2, "then open a PR")]).text).toBe(
      "run the tests\n\nthen open a PR",
    );
  });

  // A label exists to keep an expanded slash command out of the transcript. A
  // batch of plain typed messages has nothing to hide, and giving it a label
  // would print the same text twice.
  test("a batch of plain messages has no label", () => {
    expect(merge([at(1, "a"), at(2, "b")]).label).toBeNull();
  });

  test("one labelled message in the batch labels the whole delivery", () => {
    const batch: Queued[] = [
      { id: 1, text: "the expanded body of /review", label: "/review", kind: "follow-up" },
      at(2, "and then ship it"),
    ];
    expect(merge(batch).label).toBe("/review\n\nand then ship it");
    expect(merge(batch).text).toBe("the expanded body of /review\n\nand then ship it");
  });
});

describe("what Alt+Up reaches for", () => {
  // Alt+Up undoes the last thing you pressed Enter on. A rule that depended on
  // which kind you queued would mean reading the rows to predict the key.
  test("the newest across both queues, not the more urgent kind", () => {
    const steering = [at(1, "steer first", "steer")];
    const followUps = [at(2, "queued second")];
    expect(newest(steering, followUps)?.text).toBe("queued second");
  });

  test("and that is the steering message when it was queued last", () => {
    const followUps = [at(1, "queued first")];
    const steering = [at(2, "steered second", "steer")];
    expect(newest(steering, followUps)?.text).toBe("steered second");
  });

  test("nothing waiting means nothing to take back", () => {
    expect(newest([], [])).toBeNull();
  });
});

describe("what counts as a mode", () => {
  test("the two documented spellings and nothing else", () => {
    expect(isQueueMode("one-at-a-time")).toBe(true);
    expect(isQueueMode("all")).toBe(true);
    for (const wrong of ["One-At-A-Time", "batch", "", 1, null, undefined])
      expect(isQueueMode(wrong)).toBe(false);
  });
});
