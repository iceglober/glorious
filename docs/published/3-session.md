---
title: the session
---

# the session

`glrs` opens a full-screen session rooted at the repository you are in, or at the
working directory when it is not a repository: the transcript above, the composer
below it, and between them whatever is running or waiting. this is the terminal
host. `-p` runs one turn and prints, and has none of it.

## sending, and talking to a turn already running

`Enter` sends what you typed. `Shift+Enter` inserts a newline. while a turn is
running, `Enter` queues a **follow-up**: its own turn, delivered once the agent
has run out of work. it cannot change what the running turn does, which is why it
is the unmodified key.

`Alt+Enter` **steers**. the message joins the turn already in flight at its next
step boundary, so the model reads it before it chooses its next action, a
correction lands in the middle of the work rather than after it. steering is the
deliberate act, so it carries the modifier.

with nothing running the two are the same thing: a turn. a steering message that
never meets a boundary (the turn answered in one step, or you interrupted it)
becomes a follow-up at the front of the queue rather than being dropped. if the
connection drops and the request is re-sent, anything the dead attempt had
already taken goes back to the queue, in order.

## the two queues

waiting messages are listed under the transcript in the order they will be
delivered (steering first, then follow-ups, each oldest first) marked
`steering` or `queued` and clipped to 64 characters. one delivery takes the
oldest waiting message of its kind; the rest keep waiting. `steeringMode` and
`followUpMode` in config change that:

| value | one delivery takes |
| --- | --- |
| `one-at-a-time` (default) | the oldest waiting message |
| `all` | everything waiting of that kind, joined into one message |

`one-at-a-time` is the default because it is the one that lets the model answer
what you said before it reads what you said next. `all` is for when three Enters
were one thought.

`Alt+↑` (`Opt+↑` on macOS) returns the newest waiting message to the composer,
newest across both queues, so it always undoes the last thing you pressed Enter
on. retype it and send, or clear the line and it is gone: rescinding and editing
are the same gesture. a queued slash command comes back as `/review` rather than
as the page of prompt it expands to, and a draft already in the composer is kept
below it.

## stopping

`Esc` closes the completion menu when one is open and leaves your text alone,
you were dismissing a menu, not abandoning the line. the dismissal is remembered
against the exact text it happened on, so the menu stays shut while you look at
it and reopens the moment you type something else.

with no menu open, `Esc` interrupts the turn and holds the queue with it,
otherwise the message you queued two minutes ago fires into whatever state the
interrupt left behind. a held queue shows
`⏸ N held. Enter releases · Alt+Up takes the last one back`, and `Enter` on an
empty composer is what releases it.

`Ctrl+C` clears the composer when it has text. on an empty one it interrupts and
arms the quit, the status line says `Ctrl+C again to exit`, and a second press
within three seconds quits. typing anything else disarms it, and so does the
three seconds passing. on the way out glrs clears the screen and prints
`Continue with: glrs --resume <id>`.

## prompt history

`Ctrl+P` and `Ctrl+N` walk backwards and forwards through earlier prompts from
anywhere in the draft. `↑` and `↓` reach for history only at the first and last
logical line, the way a shell does, a soft-wrapped paragraph counts as one line,
so `↑` inside a long unbroken sentence still reaches history. the last 100
prompts are kept in `prompts.json` beside the session files and are shared across
sessions; slash commands and shell lines are not recorded.

## completion

`/` at the start of a word opens the command list, matched as a subsequence, so
`/ext` finds `/extensions`. `Tab` fills the selection. `↑`/`↓` move through it.
`Enter` fills the selection rather than sending when what you typed is not
already the selected name, so `Enter` twice is type, fill, send.

the menu shows at most ten rows, fewer on a short terminal, where a window
larger than the space for it is a list that looks like it refuses to scroll,
and `↑ N above · ↓ N more` under them when there is more than fits.

`@` completes paths. candidates come from ripgrep, so `.gitignore` is respected,
plus every directory that contains a file. the listing is cached for five
seconds, so a file created mid-session turns up on its own; `/reload` drops the
cache outright.

## `@path` mentions

a mention keeps its place in the message, it is what you typed, and what the
transcript shows, while the file rides along fenced in `<mentioned-files>` after
your text. the alternative is pasting a path and hoping the agent reads it, which
costs a turn and sometimes the wrong file.

- an `@` counts only at the start of a word, so `austin@example.com` is prose.
- trailing `.,;:)` are trimmed off the path.
- at most ten distinct paths per message; a file is attached whole, truncated at
  100,000 characters with `[truncated]`.
- a directory contributes its listing, not its contents: up to 200 paths, then
  `[N more]`. attaching everything under `@src` would spend the context window on
  one keystroke; the listing is what lets the model choose what to read.
- `.git`, `node_modules`, `dist`, `build`, `.next`, `coverage` and `.turbo` are
  skipped in a directory listing whatever `.gitignore` says.
- a path that does not exist prints `(no such file: @path, sent as text)` and
  the message is sent anyway.
- a path that escapes the project root is left as plain text, silently. there is
  nothing to report: it is a word in a sentence.

## direct shell

a line beginning `!` switches the composer to shell mode. the caret becomes
`<project root> $ `, `@` stops completing, and `Enter` runs the rest of the line
in the project root. `Backspace` on an empty shell composer leaves the mode.

output streams into the transcript as it arrives, stdout muted, stderr under a
`stderr:` heading, with ANSI escapes stripped and the run capped at 30,000
characters. a command that succeeds silently says
`(shell command completed with no output)`; one that fails says
`(shell command failed: <its last line>)`. none of it reaches the model or the
session file: `!` is the command you want to run yourself, beside the work,
without spending a turn on it.

## selection

dragging with the mouse copies through OSC 52, so the text reaches your local
clipboard even over ssh. a terminal that refuses OSC 52 still has its own
selection: hold `Shift` while dragging.

## what the bottom of the screen is telling you

between the transcript and the composer go the rows for work in progress: every
running tool call, listed a quarter-second after it starts so one that returns
at once never flickers into view; then any `!` command, which appears as it is
launched; then the waiting messages; then the held row when `Esc` has stopped
the queue.

the activity row sits directly under them, drawn only while something is
running: the phase and how long it has been in it (`sending`, `waiting`,
`thinking`, `writing`, or `compacting`), then the number of queued messages and
how to take one back, then `Esc interrupt`. on a terminal too narrow for all
three, the count is what goes: the rows above already carry it, and the elapsed
reading is the part that moves.

below the composer is the status line: the model, its variant in parentheses when
one is set, and `ctx 12.3k(6%)`. the percentage needs a context size for the
model, which comes from the catalogue or from config, [models and providers](./2-models.md)
covers both, and reads `unknown` when there is neither.

an extension can take any of this: `g.activity()` replaces the activity row,
`g.status()` appends a segment to the status line, `g.footer()` draws its own
rows under the composer. extension rows sit below the composer rather than above
it, so nothing an extension draws can push the thing you are typing around.

## sessions

a session is an eight-character id and a JSON file, rewritten at every step of a
turn and at the end of it rather than on the way out, so it survives the
terminal closing, the process being killed, and the machine going down mid-turn.

- `glrs --resume <id>` reopens one. the transcript is reprinted, usage is
  replayed, and the conversation the model sees is rebuilt from the events.
- `glrs --resume` with no id opens the picker: every session, newest first, by
  title, id and working directory. `Esc` cancels it.
- `/session` prints the id, the context and token totals, the cost, the event
  count and the file on disk.
- `/fork` copies the session to a new id and tells you how to resume it, the
  current one keeps going, so you can branch and come back. `/fork 40` copies the
  first 40 events, which is how you go back to before a decision.

a session's title is derived rather than stored: the most recent user message,
whitespace collapsed, first 72 characters. a session with no user message yet
reads `New session`.

session files live in `$XDG_DATA_HOME/glrs/sessions`, defaulting to
`~/.local/share/glrs/sessions` on every platform, Windows included. the
pre-rename `…/glorious/sessions` is read and never written: resuming a session
from there saves it to the new directory, so the store migrates itself one
session at a time and nothing has to be moved by hand.

## terminal setup

most terminals need nothing. glrs asks for the kitty keyboard protocol at
startup and accepts `Alt` either way it can arrive, as an `ESC` prefix from a
terminal that does not speak kitty, or as the protocol's modifier bit.

Windows Terminal takes `Alt+Enter` for fullscreen and never passes it on. unbind
it once, in the JSON settings:

```json
{
  "actions": [
    { "command": "toggleFullscreen", "keys": "f11" },
    { "command": "unbound", "keys": "alt+enter" }
  ]
}
```

the file is usually at
`%LOCALAPPDATA%\Packages\Microsoft.WindowsTerminal_8wekyb3d8bbwe\LocalState\settings.json`.
restart glrs after saving. without the remap there is no second steering chord:
`Enter` queues a follow-up and `Esc` stops the turn.

`NO_COLOR` and `TERM=dumb` both disable colour, and both are read once at
startup, so exporting either mid-session does nothing until the next one.

a chord the terminal claims for itself never reaches glrs at all, and `glrs
doctor` reports the model, credentials and extensions, not the keyboard. when a
key does nothing, the terminal's own settings are the first place to look.

what the agent does between one of your turns and the next is six tools:
[tools](./4-tools.md).
