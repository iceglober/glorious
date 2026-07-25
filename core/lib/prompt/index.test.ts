import { describe, expect, test } from "bun:test";
import {
  composePrompt,
  type PromptConfig,
  type PromptContext,
  type PromptInputs,
  profileNames,
  resolveProfile,
} from "./index";

const CTX: PromptContext = {
  cwd: "/repo",
  os: "darwin",
  date: "2026-07-12",
  gitBranch: "main",
  gitStatusSummary: "clean",
};

const inputs = (over: Partial<PromptInputs> = {}): PromptInputs => ({
  model: "claude-x",
  agentName: "glorious",
  rules: "- be nice",
  ...over,
});

const AUTO: PromptConfig = { profile: "auto" };

/** Everything above `# Project rules` — the cacheable, session-stable prefix. */
const prefix = (s: string) => s.slice(0, s.indexOf("# Project rules"));

describe("composePrompt", () => {
  test("1. deterministic: same inputs → identical instructions + version", () => {
    const a = composePrompt(AUTO, inputs({ model: "gpt-5.6-sol" }), CTX);
    const b = composePrompt(AUTO, inputs({ model: "gpt-5.6-sol" }), CTX);
    expect(a.instructions).toBe(b.instructions);
    expect(a.version).toBe(b.version);
  });

  test("2. caching contract: changing only ctx keeps the prefix AND the version", () => {
    const base = composePrompt(AUTO, inputs({ model: "gpt-5.6-sol" }), CTX);
    const moved = composePrompt(AUTO, inputs({ model: "gpt-5.6-sol" }), {
      ...CTX,
      cwd: "/elsewhere",
      date: "2027-01-01",
    });
    expect(prefix(moved.instructions)).toBe(prefix(base.instructions));
    // Version identifies prompt content, not the trial: the volatile
    // `# Environment` footer is excluded, so ctx changes don't move it...
    expect(moved.version).toBe(base.version);
    // ...but content changes (rules feed {{PROJECT_RULES}}) do.
    const ruled = composePrompt(
      AUTO,
      inputs({ model: "gpt-5.6-sol", rules: "Always use tabs." }),
      CTX,
    );
    expect(ruled.version).not.toBe(base.version);
  });

  test("3. auto-resolution maps model ids to profiles; a miss falls back to default", () => {
    expect(resolveProfile("gpt-5.6-sol")).toBe("gpt-5.6-sol");
    expect(resolveProfile("gpt-5.6-sol-2")).toBe("gpt-5.6-sol");
    expect(resolveProfile("gpt-5.6-terra")).toBe("gpt-5.6-terra");
    expect(resolveProfile("gpt-5.6-luna")).toBe("gpt-5.6-luna");
    expect(resolveProfile("gpt-5.4-nano")).toBe("gpt-5.4-nano");
    expect(resolveProfile("gpt-5.4-turbo")).toBe("gpt-5.4");
    expect(resolveProfile("deepseek-v4-pro")).toBe("deepseek-v4-pro");
    expect(resolveProfile("claude-x")).toBeNull();

    const fallback = composePrompt(AUTO, inputs({ model: "claude-x" }), CTX);
    expect(fallback.profile).toBe("default");
    expect(fallback.params).toEqual({});
    expect(fallback.instructions).toContain("You are glorious");
    expect(fallback.instructions).not.toContain("{{");
  });

  test("3b. a named profile overrides what the model id would resolve to", () => {
    const named = composePrompt({ profile: "gpt-5.6-sol" }, inputs({ model: "claude-x" }), CTX);
    expect(named.profile).toBe("gpt-5.6-sol");
    expect(named.instructions).toContain("# Goal");
  });

  test("4. flag precedence: defaults ← profile ← defined-only config flags", () => {
    const on = composePrompt(AUTO, inputs({ model: "gpt-5.4-nano" }), CTX);
    expect(on.flags.planning).toBe(true);
    expect(on.flags.smallModel).toBe(true);
    expect(on.instructions).toContain("2. Plan:");

    const off = composePrompt(
      { profile: "auto", flags: { planning: false } },
      inputs({ model: "gpt-5.4-nano" }),
      CTX,
    );
    expect(off.flags.planning).toBe(false);
    expect(off.instructions).not.toContain("2. Plan:");
    // An undefined flag leaves the profile's choice alone.
    expect(off.flags.smallModel).toBe(true);
  });

  test("5. template selection: a profile's `primary` replaces the base template", () => {
    const compact = composePrompt(AUTO, inputs({ model: "gpt-5.6-luna" }), CTX);
    expect(compact.instructions.startsWith("You are glorious, a software-engineering agent")).toBe(
      true,
    );
    expect(compact.instructions).toContain("# Mandates");
    expect(compact.instructions).toContain("# Approval");
    // The compact primary drops the base template's long-form sections.
    expect(compact.instructions).not.toContain("# Core mandates");
    expect(compact.instructions).not.toContain("# Writing style");
    expect(compact.instructions).not.toContain("# Communication");

    const base = composePrompt(AUTO, inputs({ model: "gpt-5.4" }), CTX);
    expect(base.instructions).toContain("# Core mandates");
    expect(base.instructions).toContain("# Writing style");
    expect(base.instructions).toContain("# Communication");
    expect(base.instructions).toContain("# Stop rules");
  });

  test("6. sol variant is outcome-first but keeps the verify tail", () => {
    const sol = composePrompt(AUTO, inputs({ model: "gpt-5.6-sol" }), CTX);
    expect(sol.instructions).toContain("# Goal");
    expect(sol.instructions).toContain("# Success criteria");
    expect(sol.instructions).toContain("# Judgment");
    expect(sol.instructions).not.toContain("1. Understand");
    expect(sol.instructions).toContain("Verify behavior");
    expect(sol.instructions).toContain("Verify standards");
  });

  test("7. the 5.6 profiles carry the evidence rule; others do not", () => {
    // The confabulation fix: hallucinationGuard is ON for sol/terra so neither
    // can claim validation it never ran.
    for (const model of ["gpt-5.6-sol", "gpt-5.6-terra"]) {
      const out = composePrompt(AUTO, inputs({ model }), CTX);
      expect(out.instructions).toContain("# Evidence rule");
      expect(out.instructions).toContain("re-run the check before");
    }
    expect(composePrompt(AUTO, inputs({ model: "gpt-5.4" }), CTX).instructions).not.toContain(
      "# Evidence rule",
    );
  });

  test("8. params pass through from the profile", () => {
    const deepseek = composePrompt(AUTO, inputs({ model: "deepseek-v4-pro" }), CTX);
    expect(deepseek.params).toEqual({ temperature: 1, topP: 1 });

    const sol = composePrompt(AUTO, inputs({ model: "gpt-5.6-sol" }), CTX);
    expect(sol.params.providerOptions?.openai?.reasoningEffort).toBe("high");

    const luna = composePrompt(AUTO, inputs({ model: "gpt-5.6-luna" }), CTX);
    expect(luna.params.providerOptions?.openai?.reasoningEffort).toBe("medium");
  });

  test("9. project rules and the environment footer render from inputs and ctx", () => {
    const out = composePrompt(
      AUTO,
      inputs({ model: "gpt-5.6-sol", agentName: "scout", rules: "- always use tabs" }),
      CTX,
    );
    expect(out.instructions).toContain("You are scout");
    expect(out.instructions).toContain("# Project rules\n- always use tabs");
    expect(out.instructions).toContain("cwd: /repo | os: darwin | date: 2026-07-12");
    expect(out.instructions).toContain("git: main clean");
    // The footer is last, so the expensive prefix above it stays cacheable.
    expect(out.instructions.indexOf("# Environment")).toBeGreaterThan(
      out.instructions.indexOf("# Project rules"),
    );
  });

  test("10. no residual {{ across every profile", () => {
    for (const model of [...profileNames, "claude-x"]) {
      const out = composePrompt(AUTO, inputs({ model }), CTX);
      expect(out.instructions.includes("{{")).toBe(false);
    }
  });

  test("11. hash pin: one version per profile", () => {
    // Versions recaptured 2026-07-25 for the basic-chat prompt set. A failure
    // here means prompt CONTENT changed — a separate, eval-validated decision,
    // never a refactor side effect.
    const pinned: Record<string, string> = {
      "gpt-5.6-sol": "e4a56541e521",
      "gpt-5.6-terra": "575d6c9f8d37",
      "gpt-5.6-luna": "4e1fe4ced7dc",
      "gpt-5.4": "c63b6d338aa9",
      "gpt-5.4-nano": "3bbf7a8d7cac",
      "deepseek-v4-pro": "2cdafe83563b",
      "claude-x": "acc7f5b82ead",
    };
    const pinCtx: PromptContext = {
      cwd: "/repo",
      os: "linux",
      date: "2026-01-01",
      gitBranch: "main",
      gitStatusSummary: "clean",
    };
    for (const [model, expected] of Object.entries(pinned)) {
      const out = composePrompt(AUTO, inputs({ model, rules: "" }), pinCtx);
      expect(`${model}:${out.version}`).toBe(`${model}:${expected}`);
    }
  });
});
