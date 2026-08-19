---
"@glrs-dev/glrs": patch
---

`web_fetch` now degrades as documented when its optional helpers are missing.

Bun throws when a binary is absent, and the spawn was unguarded, so a machine
without `uv` got `Executable not found in $PATH: "uvx"` instead of the plain
tag-strip fallback the docs promise. A browser that fails to start now falls
through to a plain fetch the same way.
