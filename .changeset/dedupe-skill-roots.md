---
"@glrs-dev/glrs": patch
---

An extension's skills directory is looked in once, however many extensions share it.

A disk extension's directory is wherever its file sits, so `aws-exec.ts` and `todos.ts` side by side in `~/.config/agents/extensions/` describe one `skills/` directory between them. `skillRootsFor` derived a root per extension and handed discovery that same path twice. Discovery walks every root it is given, so each skill under a shared directory was found once per extension beside it — and then collided with itself: `two skills are named "x"`, naming the same file on both sides.

Nothing surfaced today only because that directory has no `skills/` in it yet. It would have appeared the first time anyone put a skill next to an extension, and the warning it produces points at one file while claiming there are two, which is a bad half-hour for whoever reads it.

The roots are deduplicated now. The test asserts the plan really does contain several extensions resolving to one directory before it checks that the root arrives once — without that, a plan that stopped sharing directories would leave the assertion passing while testing nothing.
