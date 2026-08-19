---
title: tools
---

# tools

## machine

| tool | action |
| --- | --- |
| `read` | read UTF-8 with numbered lines |
| `write` | replace a file; create parent directories |
| `edit` | exact replacements across one or more files, atomically per call |
| `grep` | search contents with ripgrep syntax |
| `glob` | list matching files, newest first |
| `bash` | run a shell command in the Project root |

these six come from the `builtins` extension. `bash` is killed after the
configured timeout, ten minutes by default. interrupts kill its process group.

relative paths resolve from the Project root. absolute paths and `..` are not
blocked.

## optional

| tool | action | activation |
| --- | --- | --- |
| `web_fetch` | fetch up to ten pages as markdown; use Chrome for JavaScript pages | load `web-fetch` |
| `ask_user` | ask selectable questions in the TUI | load `ask-user` |
| `activate_skill` | load a skill body | appears when skills exist |
| `configure_extension` | record an accepted/declined first-party extension | appears while one is undecided |

```json
{
  "extensions": { "load": ["web-fetch", "ask-user"] }
}
```

`ask_user` is absent in print mode. `configure_extension` can write only when
`agentConfigAllowlist` permits `extensions`.

## output

tool output is capped at 30,000 characters. throws become `ERROR:` strings the
model can read and recover from.

`edit` resolves every replacement before writing anything. one bad replacement
leaves every target unchanged.

## replace or restrict

a Project extension registers first. register the same tool name to replace a
first-party implementation.

```ts
export default function (g) {
  g.filterTools((name) => name !== "bash");
}
```

`tools.disable` removes names through config. `tool_call` hooks can refuse calls
based on their arguments.

## permissions

tools run with the invoking process's permissions. there is no sandbox or
confirmation prompt. use git, worktrees, containers, and operating-system
controls when a boundary matters.
