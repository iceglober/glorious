---
"@glrs-dev/glrs": minor
---

`allowed-tools` restricts what a skill can use, `~/.glrs/skills` is read, and frontmatter nobody could read now reaches something.

**`allowed-tools` was a control that controlled nothing.** It was parsed, carried into the summary, and enforced by no filter — a skill declaring it needed only `read` and `grep` could call `bash`. It now holds the turn that activated it to that list, in the TUI and under `-p` alike. The turn is the boundary because activation is a turn-scoped act: the model asked for the skill in order to do something now. `activate_skill` is always kept, so a narrow list cannot trap the model inside the skill it just loaded.

Wiring it exposed a parser bug worth naming: the list was split on whitespace alone, so the ordinary `allowed-tools: read, grep` produced `["read,", "grep"]`. A tool named `read,` matches nothing. Harmless while the field was enforced by nobody; it would have silently withheld the very tool the skill asked for.

**`~/.glrs/skills` was never read.** `.glrs` and `.glorious` were searched at the project root only, while the ancestor walk looked for `.agents/skills` alone — so the one directory that holds your config, commands and extensions was the one place a skill could not live. All three agent directories are now searched at every level, still deduped.

**`license` and `metadata` never left the parser**, and `compatibility` reached the summary with no reader. All three are on `SkillSummary` now. A field a skill author can set and nothing can read is a field that does not exist.

`SkillSummary` itself was declared twice — once in `glrs-core` and once in `skills.ts` — which is how the two came to disagree about which fields exist. One declaration now, the same fix the extension API got.
