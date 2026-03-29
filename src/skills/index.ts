/**
 * Embedded skill files for the aflow workflow.
 * These get written to .claude/commands/ by `af skills`.
 *
 * Each skill is defined in its own file under src/skills/.
 * Skills that operate on a backlog task use the shared TASK_PREAMBLE
 * from preamble.ts to describe how to find the current task.
 */

import { think } from "./think.js";
import { work } from "./work.js";
import { workBacklog } from "./work-backlog.js";
import { fix } from "./fix.js";
import { qa } from "./qa.js";
import { ship } from "./ship.js";
import { prodResearch } from "./prod-research.js";
import { prodSpec } from "./prod-spec.js";
import { prodRefine } from "./prod-refine.js";
import { prodEnrich } from "./prod-enrich.js";
import { prodReview } from "./prod-review.js";

export const SKILLS: Record<string, string> = {
  // Engineering skills
  "think.md": think(),
  "work.md": work(),
  "work-backlog.md": workBacklog(),
  "fix.md": fix(),
  "qa.md": qa(),
  "ship.md": ship(),

  // Product skills (installed to prod/ subdirectory)
  "prod/research.md": prodResearch(),
  "prod/spec.md": prodSpec(),
  "prod/refine.md": prodRefine(),
  "prod/enrich.md": prodEnrich(),
  "prod/review.md": prodReview(),
};
