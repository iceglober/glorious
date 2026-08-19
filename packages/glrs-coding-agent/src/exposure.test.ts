import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// The rule: if the core computes something about the model interaction, an
// extension can see it. These three used to disagree — usage was computed per
// step, persisted in full, and exposed as `{ tokens }`; a tool's elapsed time
// was measured in two places that could differ; reasoning and errors were
// written to the session and never surfaced at all.
//
// Read from source rather than from the types at runtime, because what matters
// is that a field added to the session event is also added to the payload — and
// a structural type test would pass while the payload silently lacked it.

const read = (name: string): string => readFileSync(join(import.meta.dir, name), "utf8");
const readCore = (name: string): string =>
  readFileSync(join(import.meta.dir, "..", "..", "glrs-core", "src", name), "utf8");

const blockOf = (source: string, start: string, end = "\n    }"): string => {
  const at = source.indexOf(start);
  expect(at).toBeGreaterThan(-1);
  return source.slice(at, source.indexOf(end, at));
};

const events = readCore("events.ts");
const api = read("extension-api.ts");

describe("what the session records is what an extension can see", () => {
  test("every field on the usage session event reaches the usage payload", () => {
    const recorded = [...blockOf(events, 'type: "usage";').matchAll(/^\s+(\w+)\??:/gmu)]
      .map((match) => match[1])
      .filter((field) => field !== "type");
    const payload = blockOf(api, "  usage: {", "\n  };");
    expect(recorded.length).toBeGreaterThan(3);
    for (const field of recorded) {
      // `tokens` travels as contextTokens, being the context size not a count
      const named = field === "tokens" ? "contextTokens" : field;
      expect(payload).toContain(named);
    }
  });

  test("every field on the tool session event reaches the tool_end payload", () => {
    const recorded = [...blockOf(events, '      type: "tool";').matchAll(/^\s+(\w+)\??:/gmu)]
      .map((match) => match[1])
      .filter((field) => field !== "type");
    const payload = blockOf(api, "  tool_end: {", "\n  };");
    expect(recorded).toContain("elapsedMs");
    for (const field of recorded) expect(payload).toContain(field);
  });

  test("reasoning and errors are observable, not just recorded", () => {
    for (const name of ["reasoning", "error"]) {
      expect(events).toContain(`type: "${name}"`);
      expect(api).toContain(`| "${name}"`);
    }
  });
});

describe("a tool is timed once", () => {
  // chat.ts used to pair start with end and subtract, so the transcript and
  // anything else reading the same call could report different durations.
  test("the elapsed time is measured at the call and carried on the event", () => {
    expect(read("tools.ts")).toContain("const elapsedMs = Date.now() - began");
    expect(read("chat.ts")).toContain("elapsedMs: tool.elapsedMs");
  });

  test("nothing re-derives it by pairing ids", () => {
    expect(read("chat.ts")).not.toContain("started.set");
  });
});
