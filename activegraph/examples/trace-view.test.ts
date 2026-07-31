import { describe, expect, test } from "bun:test";
import type { AnyEvent } from "../domain/events";
import { innermostMessage, renderEvent } from "./trace-view";

const event = (type: string, payload: unknown): AnyEvent<never> =>
  ({
    id: 1,
    type,
    payload,
    causedBy: null,
    at: "2026-01-01T00:00:00.000Z",
    branch: "main",
  }) as never;

describe("trace view", () => {
  test("says which behavior is thinking, and stays quiet about the rest", () => {
    expect(renderEvent(event("behavior.started", { behavior: "planner" }))).toBe("planning…");
    expect(renderEvent(event("behavior.started", { behavior: "reviewer" }))).toBe(
      "reviewing the output…",
    );
    expect(renderEvent(event("behavior.started", { behavior: "finisher" }))).toBeNull();
    expect(renderEvent(event("object.created", { objectType: "command" }))).toBeNull();
    expect(renderEvent(event("llm.requested", { request: {} }))).toBeNull();
  });

  test("commands are left to withProgress, which knows when they started", () => {
    expect(
      renderEvent(event("tool.requested", { requestId: "r1", input: { command: "ls" } })),
    ).toBeNull();
    expect(renderEvent(event("tool.responded", { requestId: "r1", isError: false }))).toBeNull();
  });

  test("says when something is waiting on a person", () => {
    expect(renderEvent(event("approval.proposed", { approvalId: "a1" }))).toBe(
      "  waiting for approval",
    );
  });

  test("digs the provider's own sentence out of a nested failure", () => {
    const reason =
      'llm provider_error: {"reason":"provider_error","message":"The API deployment for this resource does not exist."}';

    expect(renderEvent(event("behavior.failed", { behavior: "planner", reason }))).toBe(
      "planner failed: The API deployment for this resource does not exist.",
    );
  });

  test("leaves a plain reason alone rather than mangling it", () => {
    expect(innermostMessage("llm output is not JSON: Sure! Here is the plan")).toBe(
      "llm output is not JSON: Sure! Here is the plan",
    );
    expect(innermostMessage('broken json: {"message": oops')).toBe('broken json: {"message": oops');
  });
});
