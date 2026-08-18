---
"@glrs-dev/glorious": patch
---

A NUL byte made a bundled extension unsearchable.

`v2/bundled/builtins.ts` used `process.env.HOME ?? "\0"` as a sentinel — chosen
because no path starts with a NUL. It was harmless at runtime and invisible on
screen, and it made the entire file **binary to ripgrep**, so every search of it
silently returned nothing. That is glorious's own `grep` tool as much as
anyone's: a file the agent cannot search is a file the agent cannot maintain.

The sentinel is gone; the check says what it means. A test now walks every `.ts`
file and fails on any C0 control character other than tab, newline and carriage
return.
