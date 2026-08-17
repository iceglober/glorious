# Troubleshooting

## Start with doctor

```sh
glorious doctor
glorious doctor --json
```

This reports the selected model, provider, missing credentials, and config
syntax diagnostics without opening the chat UI.

## Credentials

Check the provider's required environment variable on the [providers](/providers)
page. `doctor` reports what is missing without printing secret values.

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
