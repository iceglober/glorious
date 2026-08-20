---
"@glrs-dev/glrs": major
---

Unify configuration and resources into three named scopes: Project-User, Project, and User.

Project-User remains `.glrs/config.local.json`, Project remains `.glrs/config.json`, and User now owns `config.json`, extensions, commands, and skills in one platform-aware directory. User defaults to `~/.config/glrs` on macOS and Linux and `%APPDATA%\glrs` on Windows, with `GLRS_CONFIG_HOME` and `XDG_CONFIG_HOME` overrides.

Stop walking arbitrary ancestors and stop reading the legacy `.glorious`, personal `~/.glrs`, and non-skill `.agents` locations. Portable Agent Skills remain supported in Project and User `agents/skills` directories.

Use camelCase exclusively for config keys, including `toolTimeoutMs`, `steeringMode`, and `followUpMode`.
