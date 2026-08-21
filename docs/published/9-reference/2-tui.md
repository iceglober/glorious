---
title: the tui
---

# the tui

the TUI (the full-screen terminal interface) is what `glrs` opens with no
arguments. it has four parts.

```text
┌──────────────────────────────────────────────┐
│ transcript      what has happened so far     │
│                                              │
│ activity row    the running turn, or blank   │
│ composer        where you type               │
│ status line     model, context, cost         │
└──────────────────────────────────────────────┘
```

| part | shows | owned by |
| --- | --- | --- |
| transcript | messages, tool calls and notices, oldest first | glrs, or an extension's renderer |
| activity row | the phase, elapsed time, queued count. blank when idle | glrs, or `g.activity` |
| composer | what you are typing, with completion and queued messages above it | glrs, or `g.ui.capture` |
| status line | model, context used, cost | glrs, plus `g.status` segments |

## composer

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

a `g.key()` binding matches name, ctrl and shift, and runs before every row above.

## completion
`/` completes commands and `@` completes paths; shell mode offers `/` only. `enter` completes instead of sending while the menu is open. the menu shows at most 10 rows, and never more than the terminal height minus 8, with `↑ n above` and `↓ n more` for the rest. esc keeps it shut until the text changes. paths come from ripgrep, re-listed every 5s, 50 candidates.

## mentions
`@path` stays in the message and the file rides along fenced. limits: 10 mentions per message, 100,000 characters per file, 200 paths per mentioned directory. a path outside the repository stays plain text; a missing one prints `(no such file: @path, sent as text)`.

## shell
a leading `!` runs the line in the shell instead of sending it. the caret becomes `<cwd> $ ` and backspace on an empty line leaves. output has ANSI escapes stripped and is capped at 30,000 characters. exit 0 with no output prints `(shell command completed with no output)`; any other code prints `(shell command failed: <last line>)`.

## status line
```text
transcript
progress      running tools, queued messages, held queue
completion
activity      thinking 4.1s · 2 queued (Alt+↑ dequeue) · Esc interrupt
composer
footer        g.footer() rows
status        provider/model-id (variant) · ctx 41.2k(32%) · g.status() segments
```

the activity row is drawn only while busy or compacting, and `g.activity()` replaces it. the phase is `sending`, `waiting`, `thinking`, `writing`, or `compacting`. tokens and percentage read `unknown` without catalogue metadata. mouse selection copies through OSC 52 (a terminal escape the emulator turns into a clipboard write).

## session picker
`up` `down` or `k` `j` move, `shift+up` `shift+down` move 5, `enter` opens, `esc` cancels.

see also: [keys](./3-keys.md), [extensions](./11-extensions.md)
