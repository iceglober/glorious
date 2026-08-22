---
title: keys
---

# keys

every binding in the [TUI](./2-tui.md).

| --- | --- |
| `enter` | send; while busy, queue a follow-up; on an empty composer, release a held queue |
| `alt+enter` | steer the running turn at its next step |
| `shift+enter` | newline |
| `alt+up` | take the newest queued message back into the composer |
| `tab` | accept the selected completion |
| `up` `down` | move in the menu, else history from the first or last line, else the cursor |
| `ctrl+p` `ctrl+n` | previous and next prompt in history, always |
| `esc` | close the menu, else interrupt the turn and hold the queue |
| `ctrl+c` | clear the composer; when empty, interrupt; again within 3s, exit |

## terminals that take a key first

| terminal | key | fix |
| --- | --- | --- |
| Windows Terminal | `alt+enter` | claims it for fullscreen. open its settings with `ctrl+,` (**Settings**, then **Open JSON file**) and unbind it |

```json
{
  "actions": [
    {
      "command": "unbound",
      "keys": "alt+enter"
    }
  ]
}
```

restart glrs afterward. a key the terminal consumes never reaches glrs, so
nothing in glrs's own configuration can recover it.

see also: [the tui](./2-tui.md), [turns](./6-turns.md)
