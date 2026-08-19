---
"@glrs-dev/glrs": minor
---

Tear glorious down to the studs: a basic chat TUI over an agent with bash/read/edit/search tools and an Azure-only LLM. Removed: slash commands, plan/build modes, MCP, the permission system, model selection and the config system/TUI/CLI, session persistence and resume, subagents, background jobs, todos, skills, web tools, secrets/keyring, metrics, the updater, evals, and the bench harness. The CLI is now just `glorious` (plus `--help`/`--version`); Azure credentials and the model come from environment variables.
