---
title: turn things off
---

# turn things off

## every turn

`.glrs/config.json`:

```json
{
  "tools": {
    "disable": [
      "bash",
      "web_fetch"
    ]
  },
  "extensions": {
    "disable": [
      "web-fetch"
    ]
  },
  "toolTimeoutMs": 120000
}
```

- `tools.disable` withholds a tool from the model, whichever extension registered it.
- `extensions.disable` takes that extension's commands with it. disable `builtins` and nothing is left, no tools and no slash commands.
- `toolTimeoutMs` is milliseconds, default 600000, for `bash`, `grep` and `glob`. `GLRS_TOOL_TIMEOUT_MS` wins over it.
- disable lists union across the three config scopes. off in one file is off in all.

`/extensions disable web-fetch` writes that line for you, when `agentConfigAllowlist` includes `extensions`. `/reload` applies both lists. a markdown command stops loading when its file leaves `.glrs/commands/`.

## one turn

```markdown
---
allowed-tools: read, grep, glob
---
```

in a skill's frontmatter: the turn that activates the skill gets those tools and no others. disabling is not a security boundary, see [design](../3-explanation/1-design.md).

see also: [configuration](../9-reference/8-configuration.md), [tools](../9-reference/5-tools.md)
