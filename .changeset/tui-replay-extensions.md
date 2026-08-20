---
"@glrs-dev/glrs": minor
---

A resumed transcript is drawn by the extensions you have loaded.

Replay ran hundreds of lines before the extensions did, so `renderTool` returned undefined and the markdown transform chain was the identity. However many renderers an extension registered, history got glrs's own default rendering — and because the transcript is printed once into scrollback rather than re-rendered on later paints, "before the extensions" meant "wrong for the rest of the session".

The replay now happens after they load and still before the startup notices, so the transcript reads first and whatever went wrong at startup reads under it.

No assertion about output could catch this: both orders produce a transcript, and the wrong one produces a perfectly valid default. The order is the bug, so the order is what is pinned — and the guard is checked against the old arrangement to confirm it fails on it.

The tone table also stops carrying ANSI escape codes nobody read. Each entry was a `[hex, SGR]` pair and only the hex was ever used; the codes were residue of a renderer that no longer exists, alongside three exported colours with no reader.
