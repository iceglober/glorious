# Glossary

- **Agent** — the model plus tools, context, and turn loop that can inspect or
  change a repository.
- **Core** — the deliberately small runtime/API: turns, sessions, discovery,
  primitive tools, and extension seams.
- **Extension** — a TypeScript module that adds capabilities through the
  glorious API.
- **Tool** — a callable operation exposed to the model, such as `read`,
  `edit`, or an extension tool.
- **Command** — a named operation invoked by the user with `/name`; its body
  may start a turn, or an extension may provide its implementation.
- **Skill** — reusable agent instructions described by a `SKILL.md` file and
  optionally invokable as a command. Skills follow the Agent Skills
  specification; glorious adds its own invocation controls.
- **Session** — the persisted conversation that can be resumed.
- **Turn** — one request and the model/tool work it causes.
- **System prompt** — the small, stable instruction and API context the agent
  receives on every turn.
- **YOLO mode** — the absence of permission prompts. glorious uses the
  invoking process's permissions; operational boundaries belong outside it.
- **Reload** — an explicit, visible re-read of discovered skills, commands,
  and extensions.
