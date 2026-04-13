import { describe, test, expect } from "bun:test";
import { gs } from "./gs.js";
import { gsThink } from "./gs-think.js";
import { gsDeepPlan } from "./gs-deep-plan.js";
import { gsDeepReview } from "./gs-deep-review.js";
import { gsQuickReview } from "./gs-quick-review.js";
import { gsBuild } from "./gs-build.js";
import { gsBuildLoop } from "./gs-build-loop.js";
import { gsAddressFeedback } from "./gs-address-feedback.js";
import { gsQa } from "./gs-qa.js";
import { gsFix } from "./gs-fix.js";
import { gsWork } from "./gs-work.js";
import { gsShip } from "./gs-ship.js";

describe("cross-references use canonical names", () => {
  test("gs.ts skill table uses canonical names", () => {
    const output = gs();
    expect(output).toContain("/think");
    expect(output).toContain("/work");
    expect(output).toContain("/fix");
    expect(output).toContain("/qa");
    expect(output).toContain("/ship");
    expect(output).toContain("/build");
    expect(output).toContain("/deep-plan");
    expect(output).toContain("/deep-review");
    // Should NOT contain /gs- prefixed skill names
    expect(output).not.toContain("/gs-think");
    expect(output).not.toContain("/gs-work");
    expect(output).not.toContain("/gs-fix");
  });

  test("gs-think uses /deep-plan not /gs-deep-plan", () => {
    const output = gsThink();
    expect(output).toContain("/deep-plan");
    expect(output).not.toContain("/gs-deep-plan");
    expect(output).not.toContain("/gs-work");
  });

  test("gs-deep-plan uses canonical cross-refs", () => {
    const output = gsDeepPlan();
    expect(output).toContain("/build");
    expect(output).toContain("/build-loop");
    expect(output).not.toContain("/gs-build");
    expect(output).not.toContain("/gs-build-loop");
  });

  test("gs-deep-review uses canonical cross-refs", () => {
    const output = gsDeepReview();
    expect(output).toContain("deep-plan");
    expect(output).toContain('Skill("qa")');
    expect(output).toContain('Skill("ship")');
    expect(output).not.toContain("/gs-deep-plan");
    expect(output).not.toContain("/gs-qa");
    expect(output).not.toContain("/gs-ship");
  });

  test("gs-quick-review uses canonical cross-refs", () => {
    const output = gsQuickReview();
    expect(output).toContain('Skill("qa")');
    expect(output).toContain('Skill("ship")');
    expect(output).toContain('Skill("deep-plan"');
    expect(output).not.toContain("/gs-deep-review");
    expect(output).not.toContain("/gs-qa");
    expect(output).not.toContain("/gs-ship");
  });

  test("gs-build uses canonical cross-refs", () => {
    const output = gsBuild();
    expect(output).toContain("/build t3");
    expect(output).toContain("/deep-plan");
    expect(output).toContain('Skill("deep-review")');
    expect(output).toContain('Skill("quick-review")');
    expect(output).toContain('Skill("ship")');
    expect(output).not.toContain("/gs-build t3");
    expect(output).not.toContain("/gs-deep-plan");
    expect(output).not.toContain("/gs-ship");
  });

  test("gs-build-loop uses canonical cross-refs", () => {
    const output = gsBuildLoop();
    expect(output).toContain("/build");
    expect(output).toContain("/deep-plan");
    expect(output).not.toContain("/gs-build");
    expect(output).not.toContain("/gs-deep-plan");
  });

  test("gs-address-feedback uses canonical cross-refs", () => {
    const output = gsAddressFeedback();
    expect(output).toContain("/ship");
    expect(output).toContain("/deep-review");
    expect(output).toContain("/quick-review");
    expect(output).not.toContain("/gs-ship");
    expect(output).not.toContain("/gs-deep-review");
    expect(output).not.toContain("/gs-quick-review");
  });

  test("gs-qa uses canonical cross-refs", () => {
    const output = gsQa();
    expect(output).toContain("/work");
    expect(output).not.toContain("/gs-work");
  });

  test("no skill uses text-based slash command handoff", () => {
    const skills = [gs, gsThink, gsDeepPlan, gsDeepReview, gsQuickReview, gsBuild, gsBuildLoop, gsAddressFeedback, gsQa, gsFix, gsWork, gsShip];
    for (const skill of skills) {
      const output = skill();
      const matches = output.match(/respond with exactly [`']?\/\w/g);
      if (matches) {
        throw new Error(`Found text-based handoff in skill output: ${matches.join(", ")}. Use Skill tool instead.`);
      }
    }
  });

  test("AskUserQuestion option labels match dispatch keys", () => {
    const skills = [
      { name: "gs-build-loop", fn: gsBuildLoop },
      { name: "gs-build", fn: gsBuild },
      { name: "gs-deep-plan", fn: gsDeepPlan },
      { name: "gs-deep-review", fn: gsDeepReview },
      { name: "gs-quick-review", fn: gsQuickReview },
    ];

    for (const { name, fn } of skills) {
      const output = fn();

      // Split into AskUserQuestion blocks (each starts with a question: line and ends before the next heading or AskUserQuestion)
      const blocks = output.split(/Based on the user's response:/);
      // First element is before any dispatch section, skip it
      if (blocks.length <= 1) continue;

      for (let i = 1; i < blocks.length; i++) {
        const dispatchBlock = blocks[i];
        // Find the preceding block to extract option labels
        const precedingText = blocks.slice(0, i).join("Based on the user's response:");
        // Get the last set of options before this dispatch block
        const optionLabels = [...precedingText.matchAll(/label: "([^"]+)"/g)].map(m => m[1]);
        // Get the last N options (matching the count of dispatch keys in this block)
        const dispatchKeys = [...dispatchBlock.matchAll(/- \*\*([^*]+)\*\*/g)].map(m => m[1]);

        // Filter to only check option-derived keys (skip "Other (free text)" which has no option label)
        const nonOtherKeys = dispatchKeys.filter(k => !k.startsWith("Other"));

        for (const key of nonOtherKeys) {
          const hasMatchingLabel = optionLabels.some(label => label === key);
          if (!hasMatchingLabel) {
            throw new Error(
              `${name}: dispatch key "**${key}**" has no matching option label. ` +
              `Available labels: ${optionLabels.map(l => `"${l}"`).join(", ")}`
            );
          }
        }
      }
    }
  });

  test("no skill file contains /gs- slash command references (except gs-agentic CLI)", () => {
    const skills = [gs, gsThink, gsDeepPlan, gsDeepReview, gsQuickReview, gsBuild, gsBuildLoop, gsAddressFeedback, gsQa, gsFix, gsWork, gsShip];
    for (const skill of skills) {
      const output = skill();
      // Find all /gs- references that aren't gs-agentic CLI calls
      const matches = output.match(/\/gs-(?!agentic)/g);
      if (matches) {
        throw new Error(`Found /gs- reference in skill output: ${matches.join(", ")}`);
      }
    }
  });
});
