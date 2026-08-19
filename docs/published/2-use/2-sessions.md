---
title: sessions
---

# sessions

a session is a persisted conversation. it contains the transcript, model
context, usage, and extension entries.

## start

```sh
glrs
```

each TUI run without `--resume` creates a session. `glrs -p` is one-shot and
does not create a session file.

## resume

```sh
glrs --resume          # choose a session
glrs --resume <id>     # open one directly
```

exiting the TUI prints the current ID and exact resume command. resumed sessions
restore conversation context and accumulated usage.

## inspect

```text
/session
```

`/session` shows the ID, context use, token counts, cache hits, cost, event count,
and file path.

## storage

sessions are plain JSON under:

```text
${XDG_DATA_HOME:-~/.local/share}/glrs/sessions/
```

prompt history is stored beside them. there is no encryption; protect the files
with operating-system permissions.

## clear and compact

`/clear` removes the conversation the model replays. it does not erase the
transcript or reset usage.

`/compact [instruction]` summarizes older messages and keeps recent messages
verbatim. automatic compaction starts around 75% of a known model context
window.

both results persist across resume.

## extension data

extensions can add typed entries with `g.appendEntry()` and read them after a
resume with `g.entries()`.
