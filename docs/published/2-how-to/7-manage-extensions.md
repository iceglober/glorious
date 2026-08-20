---
title: manage extensions
---

# manage extensions

## turn one on

```bash
/extensions                    list loaded, then bundled ones that are not
/extensions enable web-fetch   records it in .glrs/config.json
/reload                        applies it
```

bundled: `builtins` (on unless disabled), `ask-user`, `worktree`, `web-fetch`. by hand: `{"extensions": {"load": ["web-fetch"]}}` in any config file.

## reload after an edit

`/reload` re-reads extensions, skills and commands from disk. they live in `<root>/.glrs/extensions/` and `<user config>/extensions/`, as `name.ts` or `name/index.ts`.

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

without it `/extensions enable` and the agent's `configure_extension` tool refuse and print the config line to add yourself. see the [extensions reference](../9-reference/7-extensions.md).

see also: [extensions](../9-reference/7-extensions.md), [your first extension](../1-tutorials/2-first-extension.md)
