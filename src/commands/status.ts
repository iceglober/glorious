import { command, flag } from "cmd-ts";
import { git, gitSafe, defaultBranch } from "../lib/git.js";
import { bold, dim, green, yellow, red, cyan } from "../lib/fmt.js";

export const status = command({
  name: "status",
  description: "Show current worktree status",
  args: {
    verbose: flag({
      long: "verbose",
      short: "v",
      description: "Show transition history (commits since base branch)",
    }),
  },
  handler: ({ verbose }) => {
    const branch = gitSafe("rev-parse", "--abbrev-ref", "HEAD") ?? "(detached)";
    const commit = gitSafe("rev-parse", "--short", "HEAD") ?? "???????";
    const base = detectBase();

    // Dirty state
    const porcelain = gitSafe("status", "--porcelain") ?? "";
    const dirty = porcelain !== "";
    const stateLabel = dirty ? yellow("dirty") : green("clean");

    // Ahead / behind
    const counts = gitSafe("rev-list", "--left-right", "--count", `origin/${base}...HEAD`);
    let ahead = 0;
    let behind = 0;
    if (counts) {
      const parts = counts.split(/\s+/);
      behind = parseInt(parts[0], 10) || 0;
      ahead = parseInt(parts[1], 10) || 0;
    }

    console.log(`${bold("branch")}   ${cyan(branch)}  ${dim(`(${commit})`)}`);
    console.log(`${bold("base")}     ${base}`);
    console.log(`${bold("state")}    ${stateLabel}`);

    const syncParts: string[] = [];
    if (ahead > 0) syncParts.push(green(`${ahead} ahead`));
    if (behind > 0) syncParts.push(red(`${behind} behind`));
    if (syncParts.length === 0) syncParts.push(dim("up to date"));
    console.log(`${bold("sync")}     ${syncParts.join(", ")}`);

    if (dirty) {
      const lines = porcelain.split("\n").filter(Boolean);
      const staged = lines.filter((l) => l[0] !== " " && l[0] !== "?").length;
      const modified = lines.filter((l) => l[1] === "M" || l[0] === "M").length;
      const untracked = lines.filter((l) => l.startsWith("??")).length;
      const parts: string[] = [];
      if (staged > 0) parts.push(`${staged} staged`);
      if (modified > 0) parts.push(`${modified} modified`);
      if (untracked > 0) parts.push(`${untracked} untracked`);
      if (parts.length > 0) {
        console.log(`${bold("files")}    ${parts.join(", ")}`);
      }
    }

    if (verbose) {
      const log = gitSafe(
        "log",
        "--oneline",
        "--no-decorate",
        `origin/${base}..HEAD`,
      );
      if (log && log !== "") {
        const commits = log.split("\n").filter(Boolean);
        console.log(`\n${bold("transition history")}  ${dim(`(${commits.length} commits since ${base})`)}`);
        for (const line of commits) {
          const hash = line.slice(0, 7);
          const msg = line.slice(8);
          console.log(`  ${dim(hash)} ${msg}`);
        }
      } else {
        console.log(`\n${bold("transition history")}  ${dim("no commits ahead of " + base)}`);
      }
    }
  },
});

function detectBase(): string {
  try {
    return defaultBranch();
  } catch {
    return "main";
  }
}
