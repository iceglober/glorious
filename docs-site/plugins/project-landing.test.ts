import { describe, expect, test } from "bun:test";
import { projectLanding } from "./project-landing.ts";

describe("project landing configuration", () => {
  test("normalizes a configured path and label", () => {
    expect(projectLanding({ path: "/agent/", label: " coding agent " })).toEqual({
      path: "agent",
      label: "coding agent",
    });
  });

  test("supports nested project paths", () => {
    expect(projectLanding({ path: "products/agent", label: "agent" }).path).toBe(
      "products/agent",
    );
  });

  test("rejects empty and escaping paths", () => {
    expect(() => projectLanding({ path: "", label: "agent" })).toThrow("relative URL path");
    expect(() => projectLanding({ path: "../agent", label: "agent" })).toThrow(
      "relative URL path",
    );
  });

  test("requires a label", () => {
    expect(() => projectLanding({ path: "agent", label: "" })).toThrow("label");
  });
});
