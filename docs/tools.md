# Tools

Eight built-ins. Everything else is an extension.

| Tool | What it does |
| --- | --- |
| `bash` | Runs a command with `bash -lc` in the project root. stdout, then stderr, then `[exit N]` on failure. Killed after 10 minutes, by process group. |
| `read` | Reads a UTF-8 file. Each line is prefixed `N│` — display only, never write it back. Appends any `AGENTS.md` guidance from the file's directory. |
| `write` | Writes a whole file, creating parent directories. |
| `edit` | Changes one or more files in a single call. |
| `grep` | ripgrep. Respects `.gitignore`, never looks in `.git`. |
| `glob` | Lists files matching a pattern, most recently modified first. |
| `ask_user` | Asks the user questions with selectable options. Withheld in print mode. |
| `activate_skill` | Loads a skill's full instructions. |

`web_fetch` is a bundled extension, not a built-in — see `extensions.md`.

Every tool result is capped at 30,000 characters. Paths are confined to the
project root. These never prompt, which is why they are not permission theatre.

## Why `edit` takes a list of files

`edit` applies every replacement in every file before writing anything, so a
failure leaves the tree untouched, and each file is swapped into place rather
than rewritten so a crash cannot leave one half-written.

It takes a list of files on purpose. Measured against per-file batching on work
spanning four files (`eval/edit`): **51% fewer input tokens**, one call instead
of four, four steps instead of seven, and no accuracy difference — 16/16 either
way. Prefer one call covering everything you need to touch.

Each `old_string` must match exactly, whitespace included, and occur exactly
once unless `replace_all` is set. Add surrounding lines to make it unique.

## Permissions

There are none. glorious runs in YOLO mode, which is the only mode.

As soon as an agent can write code and run code, a confirmation dialog is not a
security boundary — it is a habit you learn to click through. The real
boundaries are the ones outside the process: a container, a worktree, a branch
you can throw away, `git diff` before you push.

What glorious does enforce is the part that costs nothing and never asks:
file operations stay inside the project root, output is capped, and a killed
command takes its whole process group with it.
