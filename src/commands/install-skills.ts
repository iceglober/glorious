import { command, flag } from "cmd-ts";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { COMMANDS, SKILLS } from "../skills/index.js";
import { ok, info, warn } from "../lib/fmt.js";
import { gitRoot } from "../lib/git.js";

function installFiles(
  files: Record<string, string>,
  baseDir: string,
  force: boolean,
): { created: number; updated: number; upToDate: number } {
  let created = 0;
  let updated = 0;
  let upToDate = 0;

  for (const name of Object.keys(files)) {
    const dest = path.join(baseDir, name);
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    if (fs.existsSync(dest)) {
      const existing = fs.readFileSync(dest, "utf-8");
      if (existing === files[name] && !force) {
        upToDate++;
        continue;
      }
      fs.writeFileSync(dest, files[name]);
      updated++;
    } else {
      fs.writeFileSync(dest, files[name]);
      created++;
    }
  }

  return { created, updated, upToDate };
}

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
      description: "Install to ~/.claude/ (user-level) instead of the current project",
    }),
  },
  handler: async ({ force, user }) => {
    let claudeDir: string;

    if (user) {
      claudeDir = path.join(os.homedir(), ".claude");
    } else {
      let root: string;
      try {
        root = gitRoot();
      } catch {
        console.error("Not in a git repository (use --user to install globally)");
        process.exit(1);
      }
      claudeDir = path.join(root, ".claude");
    }

    const commandsDir = path.join(claudeDir, "commands");
    const skillsDir = path.join(claudeDir, "skills");

    // Install commands
    const cmdResult = installFiles(COMMANDS, commandsDir, force);
    // Install skills
    const skillResult = installFiles(SKILLS, skillsDir, force);

    const totalCreated = cmdResult.created + skillResult.created;
    const totalUpdated = cmdResult.updated + skillResult.updated;
    const totalUpToDate = cmdResult.upToDate + skillResult.upToDate;

    const target = user ? "~/.claude/" : ".claude/";

    if (totalCreated > 0) {
      ok(`created ${totalCreated} new file${totalCreated === 1 ? "" : "s"} in ${target}`);
    }
    if (totalUpdated > 0) {
      ok(`updated ${totalUpdated} file${totalUpdated === 1 ? "" : "s"} in ${target}`);
    }
    if (totalUpToDate > 0 && totalCreated === 0 && totalUpdated === 0) {
      ok("all skills up to date");
    }

    // List commands
    const commandNames = Object.keys(COMMANDS);
    console.log("");
    info("commands:");
    for (const name of commandNames) {
      const slug = name.replace(".md", "").replace(/\//g, ":");
      console.log(`  /${slug}`);
    }

    // List skills
    const skillNames = Object.keys(SKILLS);
    if (skillNames.length > 0) {
      console.log("");
      info("skills:");
      for (const name of skillNames) {
        const slug = name.replace(".md", "").replace(/\//g, ":");
        console.log(`  /${slug}`);
      }
    }

  },
});
