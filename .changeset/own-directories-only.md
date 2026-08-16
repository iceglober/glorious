---
"@glrs-dev/glorious": minor
---

Read only glorious's own directories and the vendor-neutral Agent Skills layout.

Discovery walked `.claude` at every level of the tree, plus `~/.claude/skills`, `~/.claude/plugins/cache` (scanned recursively) and `~/.config/amp/skills`. Another tool's entire command and skill surface therefore arrived as glorious slash commands — on this machine that meant `/wt` and `/verify` appearing in `/help` — and every one of those skills' names and descriptions was paid for in the per-turn preamble, on every turn, whether or not any of them were used.

Now: `.glorious/` and `.agents/` up the directory tree, plus `~/.agents/skills/` and `~/.config/agents/`. The neutral standard is kept, so a skill installed under `.agents/skills/` still works everywhere it did. Symlink a skill from another tool into `.agents/skills/` if you want it in glorious.

Removing the plugins cache also removed the only root that needed a recursive scan, so `discover()` no longer carries a special case keyed on a root's index in the list — arithmetic that would have silently applied nested scanning to whichever root happened to land second-to-last.
