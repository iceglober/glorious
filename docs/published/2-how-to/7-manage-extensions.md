---
title: manage extensions
---

# manage extensions

## what is loaded

```bash
/extensions
```

all four first-party extensions load, plus anything in `.glrs/extensions/`.

## reload after an edit

`/reload` re-reads extensions, skills and commands from disk. they live in `<project root>/.glrs/extensions/` and `<user config>/extensions/`, as `name.ts` or `name/index.ts`.

## replace a bundled one

disk wins over bundled, project before user. `.glrs/extensions/web-fetch.ts` loads instead of the shipped one. a `builtins.ts` of your own drops every tool and slash command with it.

## let glrs record the choice

```json
{
  "agentConfigAllowlist": [
    "extensions"
  ]
}
```

without it `/extensions disable` prints the config line for you to add by hand, and changes nothing.

see also: [extensions](../9-reference/11-extensions.md), [your first extension](../1-tutorials/2-first-extension.md)
