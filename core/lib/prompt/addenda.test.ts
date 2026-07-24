import { describe, expect, test } from "bun:test";
import { modelAddendum } from "./addenda";

describe("modelAddendum", () => {
  test("matches Gemini across providers on the complete model ref", () => {
    const vertex = modelAddendum("vertex/gemini-3.1-pro-preview");
    const google = modelAddendum("google/gemini-3.6-flash");
    expect(vertex).toContain("run_background_job");
    expect(google).toBe(vertex); // same family, same addendum
  });

  test("matches a bare gemini id too", () => {
    expect(modelAddendum("gemini-3.1-pro-preview")).toContain("run_background_job");
  });

  test("does not fire for other model families", () => {
    expect(modelAddendum("azure/gpt-5.6-luna")).toBe("");
    expect(modelAddendum("anthropic/claude-opus-4-8")).toBe("");
    // "gemini" only counts as a model prefix, not anywhere in the string.
    expect(modelAddendum("azure/not-a-geminix")).toBe("");
  });
});
