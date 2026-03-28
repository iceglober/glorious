import { command, flag } from "cmd-ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SKILLS } from "../skills/index.js";
import { ok, info, warn } from "../lib/fmt.js";
import { gitRoot } from "../lib/git.js";

export const installSkills = command({
  name: "skills",
  description:
    "Install aflow workflow skills as Claude Code slash commands",
  args: {
    force: flag({
      long: "force",
      description: "Overwrite existing skill files",
    }),
    user: flag({
      long: "user",
      description: "Install to ~/.claude/commands/ (user-level) instead of the current project",
    }),
  },
  handler: async ({ force, user }) => {
    let baseDir: string;

    if (user) {
      baseDir = path.join(os.homedir(), ".claude", "commands");
    } else {
      let root: string;
      try {
        root = gitRoot();
      } catch {
        console.error("Not in a git repository (use --user to install globally)");
        process.exit(1);
      }
      baseDir = path.join(root, ".claude", "commands");
    }

    const names = Object.keys(SKILLS);
    let created = 0;
    let updated = 0;
    let upToDate = 0;

    for (const name of names) {
      const dest = path.join(baseDir, name);
      // Create subdirectories as needed (e.g., prod/)
      fs.mkdirSync(path.dirname(dest), { recursive: true });

      if (fs.existsSync(dest)) {
        const existing = fs.readFileSync(dest, "utf-8");
        if (existing === SKILLS[name] && !force) {
          upToDate++;
          continue;
        }
        fs.writeFileSync(dest, SKILLS[name]);
        updated++;
      } else {
        fs.writeFileSync(dest, SKILLS[name]);
        created++;
      }
    }

    const target = user ? "~/.claude/commands/" : ".claude/commands/";

    if (created > 0) {
      ok(`created ${created} new skill${created === 1 ? "" : "s"} in ${target}`);
    }
    if (updated > 0) {
      ok(`updated ${updated} skill${updated === 1 ? "" : "s"} in ${target}`);
    }
    if (upToDate > 0 && created === 0 && updated === 0) {
      ok("all skills up to date");
    }

    // List what's available
    console.log("");
    info("available skills:");
    for (const name of names) {
      const slug = name.replace(".md", "").replace(/\//g, ":");
      console.log(`  /${slug}`);
    }

    if (!user) {
      // Check for .aflow/backlog.json
      const root = gitRoot();
      const backlogJson = path.join(root, ".aflow", "backlog.json");
      if (!fs.existsSync(backlogJson)) {
        console.log("");
        info("run `af start` to create a backlog — skills read tasks from .aflow/backlog.json");
      }
    }
  },
});
