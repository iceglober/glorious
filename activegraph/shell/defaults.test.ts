import { describe, expect, test } from "bun:test";
import { createFixedClock } from "../adapters/clocks";
import { canonicalLog } from "../domain/events";
import { exampleBehaviors, exampleSchema } from "../example";
import { unwrap } from "../lib/fp";
import { createDefaultRuntime } from "./defaults";

describe("createDefaultRuntime (the composition root)", () => {
  test("memory and sqlite compositions produce byte-identical canonical logs", async () => {
    const onMemory = unwrap(
      await createDefaultRuntime({
        schema: exampleSchema,
        behaviors: exampleBehaviors,
        store: "memory",
        clock: createFixedClock(),
      }),
    );
    const onSqlite = unwrap(
      await createDefaultRuntime({
        schema: exampleSchema,
        behaviors: exampleBehaviors,
        store: { sqlite: ":memory:" },
        clock: createFixedClock(),
      }),
    );
    unwrap(await onMemory.runtime.runGoal("Evaluate this startup idea"));
    unwrap(await onSqlite.runtime.runGoal("Evaluate this startup idea"));
    expect(canonicalLog(onMemory.runtime.log())).toBe(canonicalLog(onSqlite.runtime.log()));

    // And what sqlite persisted reads back as the same canonical log.
    const persisted = unwrap(await onSqlite.eventStore.read({ branch: "main" }));
    expect(canonicalLog(persisted)).toBe(canonicalLog(onMemory.runtime.log()));
  });

  test("defaults to the memory store and system clock", async () => {
    const composed = unwrap(
      await createDefaultRuntime({ schema: exampleSchema, behaviors: exampleBehaviors }),
    );
    const status = unwrap(await composed.runtime.runGoal("Evaluate"));
    expect(status.status).toBe("idle");
    expect(composed.runtime.view().objects("task")).toHaveLength(2);
  });
});
