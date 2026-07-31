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
  test("shows the command that is about to run", () => {
    expect(renderEvent(event("tool.requested", { input: { command: "wc -w README.md" } }))).toBe(
      "$ wc -w README.md",
    );
  });

  test("folds a multi-line command onto one line", () => {
    const command = `python3 - <<'PY'\nimport shutil\nshutil.rmtree('build')\nPY`;
    const rendered = renderEvent(event("tool.requested", { input: { command } })) ?? "";

    expect(rendered).toBe("$ python3 - <<'PY' import shutil shutil.rmtree('build') PY");
  });

  test("elides the middle of a command too long to scan", () => {
    const command = `find . -maxdepth 3 -type f ${"-not -path './node_modules/*' ".repeat(5)}-print`;
    const rendered = renderEvent(event("tool.requested", { input: { command } })) ?? "";

    expect(rendered).not.toContain("\n");
    expect(rendered.length).toBeLessThanOrEqual(103);
    expect(rendered).toContain("…");
    // Both ends survive, which is what makes an elided command recognisable.
    expect(rendered.startsWith("$ find . -maxdepth 3")).toBe(true);
    expect(rendered.endsWith("-print")).toBe(true);
  });

  test("marks how each command ended", () => {
    expect(renderEvent(event("tool.responded", { isError: false }))).toBe("  ok");
    expect(renderEvent(event("tool.responded", { isError: true }))).toBe("  failed");
  });

  test("says which behavior is thinking, and stays quiet about the rest", () => {
    expect(renderEvent(event("behavior.started", { behavior: "planner" }))).toBe("planning…");
    expect(renderEvent(event("behavior.started", { behavior: "finisher" }))).toBeNull();
    expect(renderEvent(event("object.created", { objectType: "command" }))).toBeNull();
    expect(renderEvent(event("llm.requested", { request: {} }))).toBeNull();
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
