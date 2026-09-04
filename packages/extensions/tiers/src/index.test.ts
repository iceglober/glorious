import { describe, expect, test } from "bun:test";
import { resolve, tiersFrom } from "./index";

// glrs ships no tiers, so every one of these is a claim about reading somebody's
// config rather than about a table we chose.

describe("reading tiers out of config", () => {
  test("a list of models becomes a tier in the order written", () => {
    const { tiers } = tiersFrom({ deep: ["anthropic/claude-opus-5", "azure/gpt-5.6-sol"] });
    expect(tiers.get("deep")).toEqual([
      { model: "anthropic/claude-opus-5" },
      { model: "azure/gpt-5.6-sol" },
    ]);
  });

  // Most tiers are one model, and writing a bare string for that is what
  // anybody tries first.
  test("a lone string is a tier of one", () => {
    expect(tiersFrom({ fast: "anthropic/claude-haiku-4-5" }).tiers.get("fast")).toEqual([
      { model: "anthropic/claude-haiku-4-5" },
    ]);
  });

  // The same model at a different effort is a different tier, which is the
  // whole reason the object form exists.
  test("a variant rides with the model", () => {
    const { tiers } = tiersFrom({
      deep: [{ model: "anthropic/claude-opus-5", variant: "high" }],
    });
    expect(tiers.get("deep")).toEqual([{ model: "anthropic/claude-opus-5", variant: "high" }]);
  });

  test("`default` names a tier and is not one", () => {
    const { tiers, fallback } = tiersFrom({ default: "balanced", balanced: "openai/gpt-5.6" });
    expect(fallback).toBe("balanced");
    expect([...tiers.keys()]).toEqual(["balanced"]);
  });

  test("anything that is not a model id is dropped rather than guessed at", () => {
    const { tiers } = tiersFrom({
      bad: ["not-a-model", 7, null, { variant: "high" }, "openai/gpt-5.6"],
    });
    expect(tiers.get("bad")).toEqual([{ model: "openai/gpt-5.6" }]);
  });

  test("a tier left with nothing usable does not exist", () => {
    expect(tiersFrom({ empty: ["nope"] }).tiers.has("empty")).toBe(false);
  });

  test("config that is not an object is no tiers, not a crash", () => {
    for (const bad of [undefined, null, "tiers", 7, []]) expect(tiersFrom(bad).tiers.size).toBe(0);
  });
});

describe("choosing within a tier", () => {
  const gaps =
    (missing: Record<string, string[]>) =>
    (label: string): readonly string[] =>
      missing[label.split("/")[0]] ?? [];

  test("the first one with credentials wins, not the first one written", () => {
    const list = [{ model: "anthropic/claude-opus-5" }, { model: "openai/gpt-5.6" }];
    expect(resolve(list, gaps({ anthropic: ["ANTHROPIC_API_KEY"] }))).toEqual({
      model: "openai/gpt-5.6",
    });
  });

  test("preference order holds when both are reachable", () => {
    const list = [{ model: "anthropic/claude-opus-5" }, { model: "openai/gpt-5.6" }];
    expect(resolve(list, gaps({}))).toEqual({ model: "anthropic/claude-opus-5" });
  });

  test("nothing reachable resolves to nothing, rather than to the first one", () => {
    const list = [{ model: "anthropic/claude-opus-5" }];
    expect(resolve(list, gaps({ anthropic: ["ANTHROPIC_API_KEY"] }))).toBeNull();
  });
});
