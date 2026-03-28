import { command, flag } from "cmd-ts";
import fs from "node:fs";
import path from "node:path";
import { SKILLS } from "../skills/index.js";
import { ok, info, warn } from "../lib/fmt.js";
import { gitRoot } from "../lib/git.js";

export const installSkills = command({
  name: "install-skills",
  description:
    "Install spec-workflow skills as Claude Code slash commands in the current repo",
  args: {
    force: flag({
      long: "force",
      description: "Overwrite existing skill files",
    }),
  },
  handler: async ({ force }) => {
    // Find the repo root
    let root: string;
    try {
      root = gitRoot();
    } catch {
      console.error("Not in a git repository");
      process.exit(1);
    }

    const skillsDir = path.join(root, ".claude", "commands", "s");

    // Create directory
    fs.mkdirSync(skillsDir, { recursive: true });

    const names = Object.keys(SKILLS);
    let installed = 0;
    let skipped = 0;

    for (const name of names) {
      const dest = path.join(skillsDir, name);
      if (fs.existsSync(dest) && !force) {
        skipped++;
        continue;
      }
      fs.writeFileSync(dest, SKILLS[name]);
      installed++;
    }

    if (installed > 0) {
      ok(`installed ${installed} skills to .claude/commands/s/`);
    }
    if (skipped > 0) {
      info(`skipped ${skipped} existing files (use --force to overwrite)`);
    }

    // List what's available
    console.log("");
    info("available skills:");
    for (const name of names) {
      const slug = name.replace(".md", "");
      console.log(`  /s:${slug}`);
    }

    // Check for .spec.json
    const specJson = path.join(root, ".spec.json");
    if (!fs.existsSync(specJson)) {
      console.log("");
      warn("no .spec.json found — skills need a spec target to work");
      console.log(
        '  Create one: echo \'{"target":"your-project"}\' > .spec.json',
      );
      console.log("  Then create: docs/spec/your-project_spec.md");
    }
  },
});
