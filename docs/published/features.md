# Features

The built-in feature set, in one place. Kept current: if something here is
wrong, that is a bug.

## Running it

| | |
| --- | --- |
| `glorious` | the chat TUI, in any git repo |
| `glorious -p "<prompt>"` | one turn, headless — answer on stdout, tool trail on stderr |
| `cat log \| glorious -p "what failed?"` | piped input joins the prompt, fenced as material |
| `glorious --resume [id]` | reopen a session; no id opens the picker |
| `glorious --model provider/model` | for this run |
| `glorious doctor [--json]` | model, provider, credentials, config diagnostics |
| `glorious --version` · `glorious update` | |

## Tools the model can call

`bash` · `read` · `write` · `edit` · `grep` · `glob` ·
`activate_skill`, plus `web_fetch` from a bundled extension and anything an
extension registers — including `ask_user`, which is a bundled extension rather than a built-in.

`edit` changes many files in one call and resolves every replacement before
writing, so a failure leaves the tree untouched. Output is capped at 30,000
characters. Paths stay inside the project, except that reads also reach
glorious's own `docs/`.

There are no permission prompts. An extension can add them — see
`tools.md` and `extensions.md`.

Each call is one line in the transcript — the call, a summary of what came back,
and how long it took — and a run of calls is closed by a receipt saying how many
there were and what they cost. Only a failure adds a second line, carrying the
reason. A tool describes its own result through `renderResult`; see
`extensions.md`.

## Typing

| | |
| --- | --- |
| `/name` | a command — `Tab` completes, `↑↓` move. Skills answer to `/skill:name` |
| `@path` | reference a file or directory; a file's contents travel with the message, a directory's listing does. Completion searches the whole tree, respects `.gitignore`, and scrolls |
| `!command` | run the rest of the line as shell |
| `Enter` | send, or queue as a follow-up if a turn is running |
| `Alt+Enter` | queue as a steering message, delivered into the running turn |
| `Shift+Enter` | newline |
| `Alt+↑` | take the newest queued message back into the composer |
| `Esc` | stop the turn and hold the queue |
| `Ctrl+C` | clear the composer · interrupt · again to quit |
| `↑` `↓` | prompt history at the edges of the draft; `Ctrl+P`/`Ctrl+N` always |

On Windows Terminal, `Alt+Enter` toggles fullscreen before glorious ever sees
it. [terminal-setup](/terminal-setup) has the remap.

## The message queue

You can type while the agent is working. What differs is when the message
lands.

**`Enter` — a follow-up.** It waits until the agent has finished everything and
then becomes its own turn. It cannot change what the running turn does, which
is why it is the default: pressing Enter while something is in flight has no
way to make things worse.

**`Alt+Enter` — a steering message.** It joins the turn that is already
running, at the next step boundary — the moment between the model finishing a
round of tool calls and deciding what to do next. The model reads it before it
takes another action, so a turn heading the wrong way can be turned around
without being thrown away and started over. With nothing running there is
nothing to steer, so it simply becomes the turn.

Waiting messages are listed above the composer, steering first, because that is
the order they will be delivered in:

```
  ↳ steering: use bun, not npm
  ↳ queued: then open a PR
```

### Taking one back

`Alt+↑` lifts the newest waiting message out of the queue and into the
composer. There is no separate rescind and no separate edit — taking it back is
both. Retype it and press `Enter` to queue it again, or clear the line and it
is gone.

Press it twice and both messages come back, stacked in queue order with a blank
line between them; the queue shrinks by two. They are one block of text at that
point, so pressing `Enter` re-queues them as a single message.

A slash command comes back as what you typed — `/review`, not the page of
prompt it expands into.

### Stopping

`Esc` stops the running turn and holds the queue with it. Nothing fires into
the state the interrupt left behind, and nothing is dumped into your composer.
What was waiting is still listed:

```
  ↳ queued: then open a PR
  ⏸ 1 held — Enter releases · Alt+Up takes the last one back
```

`Enter` on an empty composer releases it. So does sending anything else —
starting work again is not something you do by accident, so it needs no key of
its own.

## Commands

All of them are a bundled extension, not core. `/help` `/clear` `/compact`
`/session` `/skills` `/extensions` `/reload`. Shadow or replace any of them.

## Context

The conversation is summarised automatically once it passes 75% of the model's
window, keeping recent turns verbatim and carrying a brief forward. `/compact
[instruction]` does it on demand. The cut always lands on a user message, so a
tool result is never separated from the call it answers.

Summarising a long conversation is a model call that can run for minutes. The
status row counts it out — `compacting 42.1s · Esc interrupt` — and Esc stops
it, leaving the conversation exactly as it was. When it lands, the brief itself
is printed, so what the model is carrying forward is on screen rather than
described by a message about it.

Automatic compaction needs the model's context size to know what 75% means.
When the catalogue does not publish it the status line reads `ctx …(unknown)`
and only `/compact` will run — `/session` shows what glorious thinks the
window is.

`/clear` drops what the model replays and keeps the transcript. A resumed
session inherits whichever happened.

## What it reads from disk

| Path | |
| --- | --- |
| `AGENTS.md` / `AGENT.md` / `CLAUDE.md` | project rules, from the root down |
| `.glorious/extensions/*.ts` | extensions — tools, commands, hooks, rendering |
| `.glorious/commands/*.md` | `/name` prompts |
| `.agents/skills/*/SKILL.md` | skills, listed to the model and loaded on demand — see `skills.md` |
| `.glorious/config.json` | model, variant, provider settings |
| `~/.glorious/config.json` | the same, for you rather than the project |

Also `~/.agents/` and `~/.config/agents/`. Nothing reads another tool's
directories.

## Providers

Fifteen built in, plus any OpenAI-compatible endpoint given a base URL. Common
shorthands (`vertex`, `bedrock`, `gemini`, `claude`, `foundry`, `together`,
`grok`) resolve to the right one, and a near-miss is named rather than treated
as an unknown endpoint.
Credentials come from the environment; nothing is stored in a keychain and
nothing prompts. See `providers.md`.

Model metadata is cached, so context windows and prices survive being offline.

## Sessions

Plain JSON under `$XDG_DATA_HOME/glorious/sessions`. Every turn is recorded;
`--resume` replays the transcript and restores the model's context. `/session`
reports id, size, tokens, cache hits and cost.

## Extensions

The core registers no commands and no tools of its own — everything glorious
ships is written against the same API you get. Tools, slash commands, keys, CLI
flags, lifecycle hooks, tool gating, model switching, status and footer
widgets, custom row rendering, and the activity row. See `extensions.md`.

## Deliberately absent

No plan mode, no subagents, no MCP, no permission prompts, no session
encryption, no animation, no model picker, no session branching, no themes.
Each was removed or declined with a reason recorded in the commit that did it.
Most are writable as an extension.
