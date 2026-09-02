---
"@glrs-dev/glrs": minor
---

Remove `project_trust`, and say what the permission model actually is.

`project_trust` fired when a session opened and refused to start unless a handler answered `"trusted"`. Nothing shipped a handler, so the event fired and nothing listened. It was a seam for a gate that does not exist, and a seam nobody asked for.

The model, stated plainly in `3-explanation/1-design.md`:

> glrs has whatever permissions its calling context has.

There is no gate to configure and no longer a seam pretending to be one. `tool_call` can still refuse a call, but it runs in the same process as the thing it is refusing, so it is a convenience rather than a boundary. Real boundaries come from outside the process, which that page already said.
