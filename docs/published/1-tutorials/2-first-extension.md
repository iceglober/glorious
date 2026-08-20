---
title: your first extension
---

# your first extension

you will write a `stash_list` tool, load it, and watch the model call it.

you need the repository from [first turn](./1-first-turn.md).

## make a stash to find

```sh
cd /tmp/glrs-tour
echo scratch >> greeting.txt
git stash push -m scratch
```

## write the extension

```sh
mkdir -p .glrs/extensions
```

put this in `.glrs/extensions/stash-list.ts`:

```ts
import type { Extension } from "@glrs-dev/glrs/extension-api";

const extension: Extension = (g) => {
  g.tool({
    name: "stash_list",
    description: "List the git stashes in this repository.",
    input: g.z.object({ limit: g.z.number().describe("How many to list.") }),
    execute: async ({ limit }) => {
      const shell = await g.exec('git stash list -n "$1"', [String(limit)]);
      return shell.output || "no stashes";
    },
  });
};

export default extension;
```

## use it

`.glrs/extensions` is read at startup, so a new run picks the file up:

```sh
glrs -p "use stash_list"
```

the tool trail goes to stderr, the answer to stdout:

```
You have one stash: scratch, on main.
```

already inside the TUI (the full-screen terminal interface)? type `/reload` instead of restarting.

drop the stash when you are done:

```sh
git stash drop
```

## next

- [extensions](../9-reference/7-extensions.md)
- [events](../9-reference/8-events.md)
