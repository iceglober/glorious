import { describe, expect, test } from "bun:test";
import { createAgentCore, type Session } from "./index";

describe("agent core", () => {
  test("composes a provider-neutral runtime", async () => {
    const session = {
      schema: 2,
      id: "test",
      title: "Test",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      cwd: "/tmp",
      events: [],
    } satisfies Session;
    const core = createAgentCore({
      session,
      runTurn: async (input) => ({ id: "turn", input, steps: [], events: [], status: "settled" }),
      reloadExtensions: async () => {},
    });
    expect((await core.runTurn("hello")).status).toBe("settled");
  });
});
