---
"@glrs-dev/glrs": minor
---

Start the TUI without a model, and let `/model` choose one.

```bash
glrs          # was: No model configured. Set GLRS_MODEL="provider/model-id" …
```

`/model` is a slash command, and slash commands exist only inside a session, so refusing to open a session until a model was set meant the only ways in were `--model` and `GLRS_MODEL`. Now the session opens, the status row reads `no model`, and the picker opens over the composer on the first paint. `esc` cancels it; pressing enter on a message answers `(no model chosen: /model picks one)` and leaves what you typed in the composer rather than burning it on a failed turn.

`-p` is unchanged. A pipeline has nowhere to ask, so it still exits with `No model configured.` before anything runs.

The picker is the `model-picker` extension, which ships on. None of this is in the core: the core carries a `ModelOption | null`, refuses a turn without one, and exposes `g.model()` (now nullable), `g.models()`, `g.setModel()` and `g.rememberModel()`. An extension of your own can replace the whole flow.

**A provider with no credentials is a warning, not a refusal.** Every `ModelInfo` now carries `missing`: the variables or config keys glrs could not find for that provider. The picker lists models it has credentials for first and marks the rest:

```
› openrouter/~anthropic/claude-opus-latest  needs OPENROUTER_API_KEY
```

Choosing one still switches, and the turn is still sent. glrs reads the environment and config and nothing else, so Bedrock through an SSO profile, Vertex through application default credentials, and any provider an extension registers all look unconfigured and all work. Blocking on that check would break them. The provider's own refusal is the authority.

**The choice can be kept.** `agentConfigAllowlist` understands `"model"` alongside `"extensions"`, and `/model` then writes `model` and `variant` into the project's `.glrs/config.json`. Without it the choice lasts the session and `/model` prints the line to paste. Picking the default reasoning effort removes `variant` rather than writing null.
