---
title: tools
---

# tools

| tool | action | extension |
| --- | --- | --- |
| `bash` | run a command with `bash -lc` in the project root | builtins |
| `read` | read a UTF-8 text file, numbered lines | builtins |
| `write` | replace a whole file, creating parent directories | builtins |
| `edit` | exact string replacements across one or more files | builtins |
| `grep` | search contents with a regex, returns `path:line:text` | builtins |
| `glob` | list files matching a glob, newest first | builtins |
| `web_fetch` | fetch up to 10 pages as markdown, cached 15 minutes | web-fetch |
| `ask_user` | ask questions with selectable answers | ask-user |
| `configure_extension` | record an extension choice; only while one is undecided | builtins |
| `activate_skill` | load a skill's full instructions by name | core |

every tool but `activate_skill` comes from an extension. that one stays in the core because it needs the skill body, which the extension API does not carry; it registers first, so an extension can still replace it. `tools.disable` withholds a name. `ask_user` needs the TUI.

`read` prefixes each line with `N|`, display only. relative paths resolve against the project root, absolute ones are taken as given. nothing is refused: [permissions](../3-explanation/2-permissions.md). `grep` and `glob` respect .gitignore and skip `.git`; `includeIgnored` reaches ignored and hidden files.

## limits

| limit | value |
| --- | --- |
| any tool result | 30,000 characters, then `[truncated, N chars omitted]` |
| `bash` stdout, stderr | 20,000 and 9,000 characters, applied first |
| `grep` maxResults | default 100, max 500, then `[truncated at N matches]` |
| `glob` maxResults | default 200, max 1000 |
| command deadline | `toolTimeoutMs`, default 600000 |

past the deadline: SIGTERM to the process group, SIGKILL five seconds later, then `[timed out after 600s]`.

## results

one string. `bash` returns stdout, then stderr, then `[exit N]` when it fails. a thrown error becomes `ERROR: <message>`, which marks the call failed.

`edit` resolves every replacement in every file before writing anything. one bad replacement leaves every file unchanged. each file is renamed into place.

see also: [permissions](../3-explanation/2-permissions.md), [turn things off](../2-how-to/8-turn-things-off.md)
