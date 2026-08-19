---
title: commands
---

# commands

## markdown commands

a markdown file becomes `/name`:

```markdown
<!-- .glrs/commands/review.md -->
---
description: review the working diff for anything that would fail CI
---

read `git diff` and report anything that would fail CI. do not fix it yet.
```

`$ARGUMENTS` expands to all arguments. `$1` through `$9` expand one word each. a
body with no placeholder receives its arguments in an `<arguments>` block.

searched in order:

1. Project `.glrs/commands/`
2. User `<User>/commands/`

first name wins. extension commands load before skills and markdown commands.

## extension commands

use an extension when a command should run code instead of becoming a model
prompt:

```ts
export default function (g) {
  g.command("branch", {
    description: "show the current branch",
    run: async () => g.print((await g.exec("git branch --show-current")).stdout),
  });
}
```

## skills as commands

every skill is available as `/skill:name`. a skill can set `trigger` to change
the part after `skill:`.

skills keep their namespace so installing one cannot silently replace `/deploy`
or another command. fuzzy completion means typing `/deploy` can still find
`/skill:deploy`.

## project rules

glrs reads the first of `AGENTS.md`, `AGENT.md`, or `CLAUDE.md` in each directory
from the filesystem root to the project. nearer files come later in the prompt.

User rules also come from the platform config base's `agents/` directory.

rules are part of the stable prompt prefix. use them for short standing
instructions; use a skill for procedures loaded only when needed.
