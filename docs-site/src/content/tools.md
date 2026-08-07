# Built-in tools

Every tool is always available — there is no permission system and no mode
switching. The agent operates on the git repository you launched it in.

## Files

- **read** — reads a UTF-8 file, each line prefixed `N|`.
- **write** — writes a file, creating parent directories.
- **edit** — exact string replacements across one or more files in a single
  call. Everything resolves before anything is written, so a failure leaves the
  whole tree untouched, and each file is swapped in by rename.
- **grep** — ripgrep over file contents, confined to the project root.
- **glob** — lists files matching a pattern, newest first.

## Shell

- **bash** — runs a command in the project root. Killed after 10 minutes; an
  interrupt kills the whole process group.

## Web

- **web_fetch** — fetches up to ten pages and returns their content as
  markdown. Renders with an installed Chrome when there is one, so pages built
  by JavaScript work. Cross-host redirects are reported rather than followed.

## Agent

- **ask_user** — asks you questions with selectable options.
- **run_subagent** — runs one focused task in a second agent and returns its
  summary. The subagent starts without the conversation, cannot ask you
  anything, and cannot delegate further.
- **activate_skill** — loads a skill's full instructions. Present only when
  skills are found.

## MCP servers

Servers listed in `.glorious/mcp.json` — in the project or in `~/.glorious` —
add their tools alongside these. A `tools` array acts as an allowlist; omit it
to take everything the server offers. A built-in always wins a name collision.

## Output cap

Tool output over 30,000 characters is truncated for the model.
