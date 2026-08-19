---
title: Tools
---

# Tools

Every tool is always available — there is no permission system and no mode
switching. The agent operates on the git repository you launched it in.

None of them are built in. The nine below are extensions: `bash`, `read`,
`write`, `edit`, `grep` and `glob` are the `builtins` extension, `web_fetch`
and `ask_user` are their own, and `activate_skill` is the one tool the core
still registers because it needs a skill's body. All of them go through the
same `g.tool` any tool you write goes through, and the first extension to claim
a name keeps it — so replacing one means registering that name in
`.glrs/extensions/`, not shadowing anything.

## Files

- **read** — reads a UTF-8 file, each line prefixed `N|`.
- **write** — writes a file, creating parent directories.
- **edit** — exact string replacements across one or more files in a single
  call. Everything resolves before anything is written, so a failure leaves the
  whole tree untouched, and each file is swapped in by rename.
- **grep** — ripgrep over file contents.
- **glob** — lists files matching a pattern, newest first.

## Shell

- **bash** — runs a command in the project root. Killed after 10 minutes; an
  interrupt kills the whole process group.

## Web

- **web_fetch** — fetches up to ten pages and returns their content as
  markdown. Renders with an installed Chrome when there is one, so pages built
  by JavaScript work. Cross-host redirects are reported rather than followed.

## Agent

- **ask_user** — asks you questions with selectable options. Not a built-in: a bundled extension, written against `g.ui.capture`. Absent in `-p`
  mode, where there is nobody to answer.
- **activate_skill** — loads a skill's full instructions. Present only when
  skills are found.

## Extensions

A `.ts` file in `.glrs/extensions/` can register tools of its own, and they
arrive alongside these with the same event stream, output cap and error
handling. A project extension wins a name collision, so you can replace any of
them — including `bash` — with your own.

Naming a file `builtins.ts` is a blunter instrument than it looks: it shadows
the whole extension, which costs the six tools *and* every slash command, and
leaves the model unable to do anything. glrs says so at startup when it
happens. To replace one tool, register that one name.

## Permissions

There are none. glrs runs in YOLO mode, which is the only mode: once an
agent can write and run code, a confirmation dialog is not a boundary, and
neither is a path check on the tools that sit beside `bash`.

Output is capped and a killed command takes its process group with it.

## Output cap

Tool output over 30,000 characters is truncated for the model.
