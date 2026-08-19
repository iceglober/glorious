---
"@glrs-dev/glrs": minor
---

The config TUI folds provider management into the model picker. The standalone "Providers" section is gone; the picker's provider column now lists only providers you can actually use (a connected key, or detected cloud credentials) plus the current selection, and `^n` opens a "Connect a provider" catalog — the full list with status where you connect / disconnect / set up cloud auth. Connecting a provider there returns you to the catalog; a connected provider then appears in the picker.

Selecting a cloud provider now verifies its live session before opening its models: Vertex fetches an access token (catching a stale ADC / `invalid_rapt` session) and, if it's stale, drops you into the setup form to re-run the login before continuing — so you can't pick a model behind a broken session. Bedrock uses creds-present as the bar, with the turn-time auto-reauth as the backstop.
