---
title: troubleshooting
---

# troubleshooting

## start here

```sh
glrs doctor
glrs doctor --json
glrs --version
```

`doctor` checks the model, provider, credentials, config, and extension plan
without running extensions or opening the TUI. it never prints secret values.

## missing credentials

find the required environment variable under
[model providers](../2-use/providers.md). export it in the shell that starts glrs.

## wrong model

```sh
glrs --model provider/model-id doctor
```

precedence is CLI, environment, Project-User, Project, User, then default.
`GLRS_MODEL` overrides every config file.

`model` must be a string:

```json
{ "model": "azure/gpt-5.6-sol" }
```

`{"model":{"selected":"..."}}` is ignored and reported. providers are selected
by the model prefix; `"enabled": true` has no effect.

## config is ignored

check the exact paths:

| scope | path |
| --- | --- |
| Project-User | `.glrs/config.local.json` |
| Project | `.glrs/config.json` |
| User | `<User>/config.json` |

invalid JSON, wrong value types, and files with no recognized settings appear in
`doctor`. unknown keys beside a valid setting are ignored.

## extension is missing

```text
/extensions
/reload
```

`doctor` shows what would load and why a configured path failed. `/extensions`
shows what actually loaded. config changes apply after `/reload` or restart.

## offline

model metadata is cached at
`${XDG_CACHE_HOME:-~/.cache}/glrs/models.dev.json`. without it, model calls still
work; context percentage, variants, and prices may be unknown.

## resume

```sh
glrs --resume
glrs --resume <id>
```

sessions are plain JSON under
`${XDG_DATA_HOME:-~/.local/share}/glrs/sessions`.

## permissions

glrs uses the invoking process's permissions. it has no sandbox or approval
prompt. review changes with git and use a worktree or container for isolation.
