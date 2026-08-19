---
"@glrs-dev/glrs": minor
---

glrs can tell you about a capability it does not have, and remember your answer.

`web_fetch` and `ask_user` ship in the box and wait to be asked for. That is a better default than loading everything, but it has an obvious failure: an agent asked to read a web page has no tool for it, and no way to know one exists. So the extensions that ship but have never been decided about are named to the model each turn, with a line saying what each is for.

**Nothing about this costs a prompt-cache miss.** The list rides the per-turn `<extensions>` block, which is rebuilt every turn anyway; the system prompt stays byte-identical, and messages already in history keep their cached prefix. `<extensions>` is already a preamble tag, so the block is stripped from a replayed transcript without a new one being added. There is a source-scan test pinning that, because moving one call in `index.ts` would break it and no assertion about output would notice — both paths reach the model.

Once you answer, it stops being offered. When every shipped extension has been decided, the section disappears entirely: an agent that keeps offering something you already declined is worse than one that never offered. The three states need no store of their own — named in `extensions.load` is a yes, named in `extensions.disable` is a no, in neither is a question nobody has answered.

Recording the answer needs permission, because config is yours to edit and nothing glrs does writes it. `"agentConfigAllowlist": ["extensions"]` opts that one section out. With it, a `configure_extension` tool records what you said; without it the suggestion still happens and glrs tells you the line to add instead. The tool is registered only when there is something undecided and only when the answer can actually be written, since a decline that cannot be recorded lasts until the next turn.

`/extensions` now lists what ships but is not loaded alongside what is, and `/extensions enable <name>` and `/extensions disable <name>` do the same thing by hand. Unlike the extension lists, `agentConfigAllowlist` is nearest-wins rather than additive: permission to write your config is not something a project you cloned should be able to widen.
