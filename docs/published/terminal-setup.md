# Terminal setup

glrs runs in whatever terminal you already use and needs no setup in most
of them. This page covers the two places where a terminal takes a key before
glrs can see it, and what to do about it.

## `Alt+Enter` on Windows Terminal

`Alt+Enter` queues a [steering message](/features#the-message-queue) — the one
that joins the turn already running. Windows Terminal binds the same chord to
fullscreen by default and consumes it, so glrs never receives the keystroke
and pressing it appears to do nothing but resize your window.

Remap or unbind it in Windows Terminal's `settings.json` — open the settings UI
and choose **Open JSON file**, or edit
`%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json`
directly.

To move fullscreen to `F11` and leave `Alt+Enter` for glrs:

```json
{
  "actions": [
    { "command": "toggleFullscreen", "keys": "f11" },
    { "command": "unbound", "keys": "alt+enter" }
  ]
}
```

The `unbound` entry is the part that matters. Without it Windows Terminal keeps
its default binding alongside your new one, and `Alt+Enter` still goes to
fullscreen.

Save the file — Windows Terminal reloads settings on write — and restart
glrs.

### If you would rather not remap

Steering is the only thing behind that chord. Everything else has another way
in:

- `Enter` still queues a follow-up, delivered once the agent finishes all its
  work.
- `Esc` still stops the turn, which is the blunter version of turning one
  around.

There is no second chord for steering. Adding one would mean documenting two
answers to "what is the shortcut", which is worse than remapping once.

## Terminals that report `Alt` differently

glrs accepts `Alt` under both conventions terminals use for it: the older
one, where the terminal prefixes the key with `ESC`, and the
[kitty keyboard protocol](https://sw.kovidgoyal.net/kitty/keyboard-protocol/),
where it arrives as an explicit modifier bit. You do not have to choose, and
`Alt+Enter` and `Alt+↑` work either way.

This matters if you are comparing against another tool whose `Alt` chords work
in Ghostty or Kitty but not in Terminal.app — that is a tool reading only the
kitty flag.

## Colour

Colour is on when the terminal reports support for it. Two ways to turn it off:

- `NO_COLOR=1` — the [convention](https://no-color.org/) honoured across tools.
- `TERM=dumb`.

Both are read at startup.

## Mouse and selection

glrs enables mouse reporting, which is what lets it capture a drag as a
selection and copy it to your clipboard over OSC 52. In a terminal that does
not support OSC 52, or one where it is disabled, the selection is made but the
copy silently does not happen — hold `Shift` while dragging to fall back to
your terminal's own selection instead.

## When something still is not reaching glrs

`glrs doctor` reports model, provider, credentials, and configuration, but
it cannot see your terminal's key bindings. If a chord does nothing, check your
terminal's own keybinding settings first — a terminal that consumes a key never
passes it on, and glrs cannot tell the difference between that and the key
not being pressed.

See [troubleshooting](/troubleshooting) for anything that is not a key.
