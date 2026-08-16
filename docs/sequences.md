# Sequences

A sequence is the zero-code way to extend glorious: a markdown file that runs a
shell command, optionally clears the conversation, and optionally feeds the
command's output into a prompt — in that order, which is where the name comes
from. Type `$name` to run one.

```markdown
---
description: Reset to a clean main and start over
run: git checkout main && git pull --ff-only
clear: true
---

I have just reset to a clean main. Summarise what changed since my last commit.
```

Save that as `.glorious/sequences/fresh.md` and `$fresh` runs it.

| Frontmatter | Meaning |
| --- | --- |
| `run` | the shell command; required, and it always runs |
| `description` | shown in `/help` and in autocomplete |
| `clear` | drop the conversation once the shell succeeds |

The body is optional. With one, the shell's stdout is fenced into the prompt as
`<output>` so a diff or a log reads as evidence rather than as further
instructions. Without one, the sequence is a pure side effect and no turn is
produced at all.

`$1`..`$9` and `$ARGUMENTS` expand in the body; arguments also reach `run` as
real positional parameters, so `$1` and `$@` mean what a script author expects
and nothing needs quoting.

Nothing happens if the shell fails: no clear, no turn. A reset that did not
happen cannot look like one that did.

## Where they live

`.glorious/sequences/*.md`, then `.agents/sequences/` up the tree, then
`~/.config/agents/sequences/`. First name wins, so a project sequence shadows a
personal one.

Before this was called a sequence it lived in `.glorious/extensions/`. That path
still loads for one release and says where to move.

## Sequence, command, or extension?

- **Sequence** (`$name`) — run a shell command, then maybe talk about the result.
- **Command** (`/name`) — a markdown file whose body becomes the prompt. See
  `commands.md`.
- **Extension** — anything that needs real code: a tool the model can call, a
  hook, a status widget. See `extensions.md`.
