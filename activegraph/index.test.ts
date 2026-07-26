import { describe, expect, test } from "bun:test";
import {
  canonicalLog,
  compareLogs,
  createDefaultRuntime,
  createFork,
  createKit,
  createMemoryEventStore,
  createMutations,
  createRuntime,
  createSqliteEventStore,
  defineSchema,
  diffGraphs,
  pipe,
  project,
  promote,
  replayPermissive,
  replayStrict,
} from "./index";

describe("the public barrel", () => {
  test("exposes the schema → kit → runtime path and the fork/replay surface", () => {
    const surface = {
      canonicalLog,
      compareLogs,
      createDefaultRuntime,
      createFork,
      createKit,
      createMemoryEventStore,
      createMutations,
      createRuntime,
      createSqliteEventStore,
      defineSchema,
      diffGraphs,
      pipe,
      project,
      promote,
      replayPermissive,
      replayStrict,
    };
    for (const [name, value] of Object.entries(surface)) {
      expect(typeof value, name).toBe("function");
    }
  });
});
