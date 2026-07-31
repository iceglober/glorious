import { describe, expect, test } from "bun:test";
import { looksDestructive } from "./coding-agent";

/**
 * A table, because the interesting content of this predicate is the examples.
 * A miss runs something unseen; a false alarm trains the operator to stop
 * reading the prompt, which costs more than the alarm was worth.
 */
const ESCALATES = [
  "rm -rf build",
  "ls && rm -rf build",
  "echo hi; rm -rf x",
  "rm -r ./dist",
  "rm -f secrets.txt",
  // The shapes that reach a shell without being first on the line.
  "find . -mindepth 1 ! -name README.md -exec rm -rf -- {} +",
  "find . -name '*.tmp' | xargs rm -f",
  "sh -c 'rm -rf /tmp/x'",
  "$(rm -rf x)",
  "sudo apt-get install ripgrep",
  "dd if=/dev/zero of=/dev/disk2",
  "mkfs.ext4 /dev/sdb1",
  "git reset --hard HEAD~1",
  "git clean -fd",
  "git push --force origin main",
  "git push -f origin main",
  // Discarding uncommitted work, which the planner is told never to do.
  "git checkout -- .",
  "git restore src/text.ts",
  // Deleting without saying `rm`.
  "find . -name '*.tmp' -delete",
  "truncate -s 0 important.log",
];

const RUNS_QUIETLY = [
  "ls -la",
  "wc -w README.md",
  "npm run build",
  "git push origin main",
  "git status --porcelain",
  "rmdir empty-dir",
  // The false alarms that anchoring exists to prevent.
  "cat notes/dd/readme.md",
  'grep -r "sudo" .',
  'echo "rm -rf is dangerous"',
  "git commit -m 'confirm -f behaviour'",
  "cat docs/reboot-procedure.md",
  // Moving between branches is not discarding work.
  "git checkout main",
  "git checkout -b feature/thing",
  "git commit -m 'restore the docs'",
  "find . -name '*.ts' -print",
  // Truncation with `>` is how nearly every file gets written; gating it would
  // gate everything and teach the operator to stop reading the prompt.
  "printf hello > notes.txt",
];

describe("looksDestructive", () => {
  test.each(ESCALATES)("escalates: %s", (command) => {
    expect(looksDestructive(command)).toBe(true);
  });

  test.each(RUNS_QUIETLY)("runs quietly: %s", (command) => {
    expect(looksDestructive(command)).toBe(false);
  });
});
