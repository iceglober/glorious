# What glorious does

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

`bash` · `read` · `write` · `edit` · `grep` · `glob` · `ask_user` ·
`activate_skill`, plus `web_fetch` from a bundled extension and anything an
extension registers.

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
| `/name` | a command — `Tab` completes, `↑↓` move |
| `$name` | a sequence: shell, then optionally a prompt |
| `@path` | reference a file or directory; a file's contents travel with the message, a directory's listing does. Completion searches the whole tree, respects `.gitignore`, and scrolls |
| `!command` | run the rest of the line as shell |
| `Enter` | send, or queue if a turn is running |
| `Shift+Enter` | newline |
| `Esc` | interrupt the turn; with none running, take back the newest queued message |
| `Ctrl+C` | clear the composer · interrupt · again to quit |
| `↑` `↓` | prompt history at the edges of the draft; `Ctrl+P`/`Ctrl+N` always |

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
| `.glorious/sequences/*.md` | `$name` shortcuts |
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
