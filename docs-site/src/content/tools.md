# Built-in tools

Every tool is always available — there is no permission system and no mode
switching. The agent operates on the git repository you launched it in.

## Files & shell

- **read / search** — ripgrep-powered, confined to the project root.
- **edit** — string replacement (strategy: `exact`, `batch` (default), `hash`).
- **bash** — runs in the project root on your machine.

## Output cap

Tool output over 30k chars is truncated for the model; the full value spills to
a session temp file the agent can read back in slices.
