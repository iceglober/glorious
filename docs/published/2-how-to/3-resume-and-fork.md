---
title: resume and fork
---

# resume and fork

## resume

```sh
glrs --resume            # pick from a list
glrs --resume 3f9a1c2b   # open that session
```

the picker lists every session newest first, titled by your last message, with its id and directory. `enter` opens, `esc` cancels.

## fork

```
/session     # read the event count
/fork 42     # copy the first 42 events to a new id
/fork        # copy all of them
```

events include tool calls and results, not just messages. `/fork` prints the new id and leaves you where you are; open the branch with `glrs --resume <id>`.

## inspect

`/session` prints the current id, context, tokens, cost, event count and file path.

sessions are JSON under `$XDG_DATA_HOME/glrs/sessions`, else `~/.local/share/glrs/sessions`. see [configuration](../9-reference/5-configuration.md).
