---
title: manage extensions
---

# manage extensions

## what is loaded

```bash
/extensions
```

all six first-party extensions load, plus anything in `.glrs/extensions/`:
`builtins`, `model-picker`, `tiers`, `ask-user`, `web-fetch`, `worktree`.

## reload after an edit

`/reload` re-reads extensions, skills and commands from disk. they live in `<project root>/.glrs/extensions/` and `<user config>/extensions/`, as `name.ts` or `name/index.ts`.

## replace a bundled one

disk wins over bundled, project before user. `.glrs/extensions/web-fetch.ts` loads instead of the shipped one. a `builtins.ts` of your own drops every tool and slash command with it, and a `model-picker.ts` of your own is what `/model` then runs.

## let glrs record the choice

```json
{
  "agentConfigAllowlist": [
    "extensions"
  ]
}
```

without it `/extensions disable` prints the config line for you to add by hand, and changes nothing. `"model"` is the other section it understands, for what `/model` chose: [configuration](../9-reference/14-configuration.md).

see also: [extensions](../9-reference/11-extensions.md), [your first extension](../1-tutorials/2-first-extension.md)
