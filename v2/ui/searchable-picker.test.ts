import { describe, expect, test } from "bun:test";
import { searchScore } from "./searchable-picker";

describe("searchable picker", () => {
  test("ranks exact and prefix matches ahead of subsequences", () => {
    expect(searchScore("openai", ["OpenAI"])).toBeGreaterThan(searchScore("openai", ["x-openai"])!);
    expect(searchScore("oa", ["OpenAI"])).not.toBeNull();
  });

  test("excludes items with no matching field", () => {
    expect(searchScore("vertex", ["Anthropic", "ANTHROPIC_API_KEY"])).toBeNull();
  });
});
