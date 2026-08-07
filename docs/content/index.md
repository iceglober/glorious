# glorious

A terminal-based coding agent.

## Quickstart

You need [Bun](https://bun.sh) and git. Install, then set your Azure key:

```
bun add --global @glrs-dev/glorious@next
export AZURE_OPENAI_API_KEY=…   # or AZURE_FOUNDRY_API_KEY / AZURE_API_KEY
export AZURE_RESOURCE_NAME=…     # your Azure AI Foundry resource
```

Start a session in any git repository:

```
glorious
```

`glorious --resume` reopens an earlier session; pass a session ID to skip the
picker. Sessions are stored under `$XDG_DATA_HOME/glorious/sessions` and
encrypted with a key from the macOS Keychain — set `GLORIOUS_SESSION_ENCRYPTION=0`
to turn that off.

## Tools

The agent has ten tools:

| tool | does |
| --- | --- |
| `bash` | Runs a command in the project root. Killed after 10 minutes; an interrupt kills the process group. |
| `read` | Reads a UTF-8 file, each line prefixed `N|`. |
| `write` | Writes a file, creating parent directories. |
| `edit` | Exact string replacements across one or more files in a single call. |
| `grep` | ripgrep over file contents, confined to the project root. |
| `glob` | Lists files matching a pattern, newest first. |
| `web_fetch` | Fetches up to ten pages and returns their content as markdown. |
| `ask_user` | Asks you questions with selectable options. |
| `run_subagent` | Runs one focused task in a second agent and returns its summary. |
| `activate_skill` | Loads a skill's full instructions. Present only when skills exist. |

`edit` takes a list of files, each with its own replacements. Every replacement
in every file is resolved before anything is written, so a failure leaves the
whole tree untouched, and each file is swapped in by rename rather than
rewritten in place.

Tool output over 30,000 characters is truncated.

## Slash commands

| command | does |
| --- | --- |
| `/help` | Keys and commands. |
| `/models` | Switch the active model. |
| `/skills` | List discovered skills. Press `r` to reload from disk. |
| `/mcp` | List connected MCP servers. |

## Keys

- **Enter** submits, **Shift+Enter** inserts a newline.
- **Esc** removes the newest queued message, then interrupts the running turn.
- **Ctrl+C** clears the composer; twice on an empty composer exits.
- **↑/↓** or **Ctrl+P/N** browse prompt history.
- **!** as the first character switches to shell mode, running the line
  directly instead of sending it to the model. **Backspace** on an empty line
  leaves.
- Mouse-select copies to the clipboard.

## Project rules

At startup glorious reads `AGENTS.md`, `AGENT.md` or `CLAUDE.md` from the
working directory upwards to your home directory, plus system-wide and
`~/.config/amp` locations. Nearer files come last, so a nested directory's
rules override the ones above it.

## Skills

A skill is a directory holding a `SKILL.md` with `name` and `description`
frontmatter. Only those two fields go into the prompt; the body loads when the
agent calls `activate_skill`, so an unused skill costs almost nothing.

Skills are discovered from `.agents/skills` and `.claude/skills` in every
directory from the working directory up to home, plus `.glorious/skills` in the
project and the usual home-level locations. First name wins.

:::details MCP servers

Configure servers in `.glorious/mcp.json`, in the project or in `~/.glorious`:

```json
{
  "mcpServers": {
    "serena": {
      "command": "uvx",
      "args": ["--from", "git+https://github.com/oraios/serena",
               "serena", "start-mcp-server", "--transport", "stdio",
               "--project-from-cwd"],
      "tools": ["find_symbol", "find_referencing_symbols", "rename_symbol"]
    }
  }
}
```

`tools` is an allowlist — omit it to take everything the server offers. A
built-in always wins a name collision, and anything dropped is reported at
startup. Servers are connected once when glorious starts, so the tool set stays
fixed for the session.

:::

:::details Environment

- `AZURE_FOUNDRY_API_KEY` / `AZURE_API_KEY` / `AZURE_OPENAI_API_KEY` — the model key. First one set wins.
- `AZURE_RESOURCE_NAME` — your Azure AI Foundry resource.
- `GLORIOUS_MODEL` — model override; the default is `gpt-5.6-luna`.
- `GLORIOUS_SESSION_ENCRYPTION` — set to `0` to store sessions unencrypted.
- `XDG_DATA_HOME` — where sessions are kept; defaults to `~/.local/share`.

:::

:::details Optional binaries

Neither is required; both improve a tool when present.

- **Chrome or Chromium** — `web_fetch` renders with it, so pages that build
  their content with JavaScript work. Without it, a plain fetch is used.
- **`uv`** — `web_fetch` extracts article text with trafilatura through `uvx`.
  Without it, markup is stripped instead.

:::
