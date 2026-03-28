import { subcommands, run, binary } from "cmd-ts";
import { create } from "./commands/create.js";
import { checkout } from "./commands/checkout.js";
import { list } from "./commands/list.js";
import { del } from "./commands/delete.js";
import { cleanup } from "./commands/cleanup.js";
import { initHooks } from "./commands/init-hooks.js";
import { startWork } from "./commands/start-work.js";
import { upgrade } from "./commands/upgrade.js";
import { installSkills } from "./commands/install-skills.js";
import { HELP_TEXT } from "./help.js";
import { VERSION } from "./lib/version.js";

// Intercept --help / -h / no-args before cmd-ts to show our full manual
const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h" || args[0] === "help") {
  console.log(HELP_TEXT);
  process.exit(0);
}
if (args[0] === "--version" || args[0] === "-V") {
  console.log(`wtm ${VERSION}`);
  process.exit(0);
}

const cli = subcommands({
  name: "wtm",
  version: VERSION,
  description: "Worktree manager for regular (non-bare) git repositories",
  cmds: {
    create,
    checkout,
    list,
    delete: del,
    cleanup,
    "init-hooks": initHooks,
    "start-work": startWork,
    "install-skills": installSkills,
    upgrade,
  },
});

run(binary(cli), process.argv);
