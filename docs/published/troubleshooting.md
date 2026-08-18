---
title: Troubleshooting
---

# Troubleshooting

## Diagnostics

```sh
glorious doctor
glorious doctor --json
```

This reports the selected model, provider, missing credentials, and config
syntax diagnostics without opening the chat UI.

## Credentials

Check the provider's required environment variable on the [Providers](./providers.md)
page. `doctor` reports what is missing without printing secret values.

## The status line shows a model I did not choose

Almost always a config file that is not being read, or one whose `model` is not
a string. `glorious doctor` names both:

```
model: azure/gpt-5.6-luna
.glorious/config.json: "model" should be a string like "azure/gpt-5.6-sol", got object — ignored
```

- **`model` takes a string**, not an object: `"model": "azure/gpt-5.6-sol"`. A nested `{"selected": "…"}` is ignored.
- **The filename is `config.json` or `config.local.json`**, inside `.glorious/`. No other name is read.
- **Providers are not enabled or disabled.** A provider is used when a model names it and its credentials are present; `"enabled": true` does nothing.
- **`~/.config/glorious/config.json` may be an old one.** Earlier versions used a nested `agent.llm` shape; none of it is read now, and `doctor` says so.

With no configuration at all the model is `azure/gpt-5.6-luna`. Seeing exactly
that is the sign nothing you wrote is being applied.

## Wrong model or provider

Use a fully qualified model label:

```sh
glorious --model provider/model-id
```

`GLORIOUS_MODEL` overrides both project and personal config. OpenAI-compatible
providers need a configured base URL.

## Offline use

The models.dev catalogue is cached under `$XDG_CACHE_HOME/glorious/models.dev.json`.
Without a catalogue response, the selected model can still run, but context and
pricing metadata may be unavailable.

## Sessions

Sessions are plain JSON under `$XDG_DATA_HOME/glorious/sessions`. Resume with:

```sh
glorious --resume
glorious --resume <id>
```

## Access and permissions

glorious has no permission prompt or sandbox. It uses the invoking process's
permissions. Use a worktree, container, or operating-system boundary when you
need isolation, and review changes with git.
