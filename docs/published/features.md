---
title: features
---

# features

## run modes

| command | behavior |
| --- | --- |
| `glrs` | interactive TUI |
| `glrs -p "<prompt>"` | one headless turn |
| `glrs --resume [id]` | resume a session |
| `glrs --model provider/model` | model override |
| `glrs doctor [--json]` | diagnostics without running extensions |

## tools

`bash` · `read` · `write` · `edit` · `grep` · `glob` · `activate_skill`, plus
extension tools. `configure_extension` also appears while a shipped extension
is undecided.

`builtins` supplies the six machine tools. `activate_skill` exists only when a
skill is available. `web_fetch` and `ask_user` ship off by default:

```json
{ "extensions": { "load": ["web-fetch", "ask-user"] } }
```

tools run with your process permissions. paths are not sandboxed. output is
capped at 30,000 characters.

## composer

| input | behavior |
| --- | --- |
| `/name` | run a command |
| `/skill:name` | run a skill yourself |
| `@path` | attach a file or directory |
| `!command` | run shell directly |
| `enter` | send, or queue a follow-up |
| `alt+enter` | queue steering for the running turn |
| `shift+enter` | newline |
| `alt+↑` | take back the newest queued message |
| `esc` | stop the turn and hold the queue |
| `ctrl+c` | clear; interrupt; press again to quit |

## queue

follow-ups wait until all current work finishes. steering enters the running
turn before its next model step.

```text
↳ steering: use bun, not npm
↳ queued: then open a PR
```

`alt+↑` returns the newest queued message to the composer. `esc` stops the turn
without dropping the queue. `enter` on an empty composer releases a held queue.

`steering_mode` and `follow_up_mode` choose whether each delivery takes one
message or all waiting messages.

## context

automatic compaction starts around 75% of a known model window. recent messages
stay verbatim; older messages become a summary. `/compact [instruction]` runs it
manually. `/clear` drops model context but keeps the transcript and usage.

## disk inputs

| path | purpose |
| --- | --- |
| `AGENTS.md`, `AGENT.md`, `CLAUDE.md` | project rules |
| `.glrs/config.json` | Project config |
| `.glrs/config.local.json` | Project-User config |
| `.glrs/extensions/` | Project extensions |
| `.glrs/commands/` | Project commands |
| `.glrs/skills/` | Project glrs skills |
| `.agents/skills/` | Project portable skills |
| `<User>/` | User config, extensions, commands, and skills |

## extensions

extensions can add tools, commands, flags, key bindings, hooks, model switching,
status/footer/activity rows, and custom rendering. Project loads before User and
both load before shipped extensions.

## deliberately absent

no plan mode, subagents, MCP, permission prompts, model picker, session
branching, animation, or themes. most are possible as extensions.
