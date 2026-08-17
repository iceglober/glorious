# Glossary

- **Agent** — the model plus tools, context, and turn loop that can inspect or change a repository.
- **Core** — the small runtime and extension seams: turns, sessions, discovery, and primitive tools.
- **Extension** — a TypeScript module that adds capabilities through the glorious API.
- **Tool** — a callable operation exposed to the model, such as `read`, `edit`, or an extension tool.
- **Command** — a named user operation invoked with `/name`.
- **Skill** — reusable instructions in a `SKILL.md` file, optionally invokable as a command.
- **Session** — the persisted conversation that can be resumed.
- **Turn** — one request and the model/tool work it causes.
- **System prompt** — the stable instructions and API context the agent receives on every turn.
- **YOLO mode** — no permission prompts; access matches the invoking process.
- **Reload** — an explicit re-read of discovered skills, commands, and extensions.
