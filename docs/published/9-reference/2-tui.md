---
title: the tui
---

# the tui

the TUI (the full-screen terminal interface) is what `glrs` opens with no
arguments.

```text
transcript     everything that has happened, oldest first
progress       running tools, queued messages, a held queue
completion     commands or paths, while you are typing one
activity       thinking 4.1s · 2 queued (Alt+↑ dequeue) · Esc interrupt
composer       where you type
footer         empty unless an extension draws here
status         provider/model-id (variant) · ctx 41.2k(32%)
```

the status row reads `no model` until one is chosen, and the picker opens over
the composer on the first paint: [models](./4-models.md).

| row | drawn | replaceable with |
| --- | --- | --- |
| transcript | always | a tool renderer, `g.markdown` |
| progress | while a tool runs, or a message waits | |
| completion | while a completion is open | `g.autocomplete` adds a source |
| activity | while busy or compacting | `g.activity` |
| composer | always | `g.ui.capture` |
| footer | never, by default | `g.footer` |
| status | always | `g.status` adds segments |

## composer

where you type. one line grows to many; `shift+enter` adds a line without
sending. queued messages are listed above it, and completion opens below.

every binding: [keys](./3-keys.md).

## the activity row

the activity row is drawn only while busy or compacting, and `g.activity()` replaces it. the phase is `sending`, `waiting`, `thinking`, `writing`, or `compacting`. tokens and percentage read `unknown` without catalogue metadata. mouse selection copies through OSC 52 (a terminal escape the emulator turns into a clipboard write).

## session picker
`up` `down` or `k` `j` move, `shift+up` `shift+down` move 5, `enter` opens, `esc` cancels.

see also: [keys](./3-keys.md), [extensions](./11-extensions.md)
