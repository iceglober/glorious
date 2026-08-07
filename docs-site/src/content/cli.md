# CLI reference

## Commands

```sh
glorious                      # open a session in the current git repo
glorious --resume             # pick an earlier session
glorious --resume <id>        # reopen one directly
glorious --version            # print the version
glorious update               # update to the latest next release
```

## Environment

- `AZURE_FOUNDRY_API_KEY` / `AZURE_API_KEY` / `AZURE_OPENAI_API_KEY` — the model
  key. First one set wins.
- `AZURE_RESOURCE_NAME` — your Azure AI Foundry resource.
- `GLORIOUS_MODEL` — model override; the default is `gpt-5.6-luna`.
- `GLORIOUS_SESSION_ENCRYPTION` — set to `0` to store sessions unencrypted.
- `XDG_DATA_HOME` — where sessions live; defaults to `~/.local/share`.

## Sessions

Sessions are written to `$XDG_DATA_HOME/glorious/sessions` and encrypted with a
key from the macOS Keychain. Each one records the whole conversation, so
`--resume` replays the transcript and the model keeps its context.
