---
"@glrs-dev/glrs": minor
---

Skills follow the Agent Skills standard, and say when they cannot.

- **Every field the standard defines is recognised** — `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` — alongside glorious's own `trigger`. Fields nothing knows about are ignored rather than rejected, so a skill written for another agent loads here unchanged. `allowed-tools` is parsed and shown; nothing is restricted to it yet.
- **`disable-model-invocation: true`** keeps a skill out of the system prompt and out of `activate_skill`, leaving it available as `/name`. **This field is not part of the Agent Skills specification** — it is a convention several agents arrived at independently, common enough now that a skill carrying it expects it honoured. `docs/skills.md` says so plainly rather than implying the standard promises it.
- **Discovery is recursive.** Only the top level of each skills directory was searched, so skills grouped into folders — which is how anyone with more than a handful organises them — were invisible. A directory containing a `SKILL.md` is a skill and is not searched further, so its own `references/` and `scripts/` are never mistaken for more skills.
- **Validation is lenient and loud.** A non-standard name, an oversized description, a directory whose name no longer matches the skill: each warns in the transcript and loads anyway. Only a missing name or description stops a skill loading. Previously every one of these was a silent drop — a skill whose folder had been renamed simply ceased to exist, which looks exactly like a skill nobody wrote.
- **Name collisions warn** instead of silently keeping the first.
- **`/skills` shows what the model can reach.** A skill that opted out is tagged `you only`, and the heading counts how many of the loaded skills are actually offered.

New `docs/skills.md`, named in the system prompt, covering the layout, the
frontmatter, progressive disclosure, and when a skill should have been a command
instead.
