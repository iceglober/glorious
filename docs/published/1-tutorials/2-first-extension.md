---
title: your first extension
---

# your first extension

you will write a `branches` tool, load it, and watch the model call it.

## set up a scratch repo

```bash
mkdir /tmp/glrs-tour && cd /tmp/glrs-tour && git init
printf 'hello\n' > greeting.txt
git add -A && git commit -m start
git branch fix-login
git branch add-tests
```

## write the extension

```bash
mkdir -p .glrs/extensions
```

put this in `.glrs/extensions/branches.ts`:

```typescript
import type { Extension } from "@glrs-dev/glrs/extension-api";

const extension: Extension = (g) => {
  g.tool({
    name: "branches",
    description: "List this repository's branches, newest commit first.",
    input: g.z.object({}),
    execute: async () => {
      const shell = await g.exec(
        "git for-each-ref --sort=-committerdate refs/heads --format='%(refname:short) %(committerdate:relative)'",
      );
      return shell.output || "no branches";
    },
  });
};

export default extension;
```

three things: a default export taking `g`, a zod schema from `g.z` so the
extension needs no imports of its own, and `g.exec` for the shell.

## use it

`.glrs/extensions` is read at startup, so a new run picks it up.

```bash
glrs --model anthropic/claude-opus-5 -p "which branch was touched most recently?"
```

the model has no git tool, sees `branches` in its tool list, and calls it:

```text
add-tests, committed 2 minutes ago.
```

`-p` loads extensions exactly as a session does, which makes it the fastest way
to check one works.

next: [have glrs write the extension](./3-self-authoring.md), [extensions](../9-reference/11-extensions.md), [events](../9-reference/12-events.md)
