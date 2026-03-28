import fs from "node:fs";
import path from "node:path";
import { gitRoot } from "../lib/git.js";
import type { Backlog, Task } from "./backlog.js";

/** Regenerate .wtm/spec.md from backlog data. */
export function generateSpec(backlog: Backlog): void {
  const specPath = path.join(gitRoot(), ".wtm", "spec.md");
  const dir = path.dirname(specPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  const lines: string[] = [];

  lines.push(`# ${capitalize(backlog.project)} — Spec`);
  lines.push("");
  lines.push("> Auto-generated from \\`.wtm/backlog.json\\`. Manage tasks in the WTM TUI.");
  lines.push("");
  lines.push("---");
  lines.push("");

  for (const task of backlog.tasks) {
    lines.push(`## ${task.id}: ${task.title}`);
    lines.push("");
    lines.push(`**Status:** ${task.status}${task.branch ? `  |  **Branch:** ${task.branch}` : ""}${task.pr ? `  |  **PR:** ${task.pr}` : ""}`);
    lines.push("");

    if (task.description) {
      lines.push(task.description);
      lines.push("");
    }

    if (task.items.length > 0) {
      lines.push("### Items");
      for (const item of task.items) {
        lines.push(`- [${item.done ? "x" : " "}] ${item.text}`);
      }
      lines.push("");
    }

    if (task.acceptance.length > 0) {
      lines.push("### Acceptance criteria");
      for (const ac of task.acceptance) {
        lines.push(`- ${ac}`);
      }
      lines.push("");
    }

    if (task.design) {
      lines.push(`**Design:** [${task.design}](designs/${task.design})`);
      lines.push("");
    }

    lines.push("---");
    lines.push("");
  }

  if (backlog.tasks.length === 0) {
    lines.push("*No tasks yet. Add tasks in the WTM TUI.*");
    lines.push("");
  }

  fs.writeFileSync(specPath, lines.join("\n"));
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
