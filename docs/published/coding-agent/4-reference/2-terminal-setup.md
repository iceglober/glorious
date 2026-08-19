---
title: terminal setup
---

# terminal setup

most terminals need no configuration.

## alt+enter on Windows Terminal

`alt+enter` steers a running turn. Windows Terminal uses it for fullscreen and
consumes the key before glrs sees it.

open Windows Terminal's JSON settings and unbind it:

```json
{
  "actions": [
    { "command": "toggleFullscreen", "keys": "f11" },
    { "command": "unbound", "keys": "alt+enter" }
  ]
}
```

settings are usually at:

```text
%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json
```

restart glrs after saving. without the remap, use `enter` for a follow-up or
`esc` to stop the turn; there is no second steering chord.

## alt conventions

glrs accepts both terminal conventions: an `ESC` prefix and the kitty keyboard
protocol's modifier bit. `alt+enter` and `alt+↑` work under either.

## color

```sh
NO_COLOR=1 glrs
TERM=dumb glrs
```

both are read at startup.

## mouse selection

glrs copies selected text through OSC 52. if the terminal blocks OSC 52, hold
`shift` while dragging to use the terminal's own selection.

## keys never arrive

`doctor` cannot inspect terminal bindings. when a chord does nothing, check the
terminal's key settings first.
