---
"@glrs-dev/glrs": patch
---

`ask_user` ships as its own package rather than a second entry point on the builtins one.

`packages/extensions/builtins` exported two extensions: `.` for the slash commands and `./ask-user` for the question widget. They share nothing — no code, no types, no reason to be versioned together — and the arrangement made `builtins` a package whose name described half its contents. `ask_user` now lives in `packages/extensions/ask-user`, exporting one thing from one path, and the bundled roster names it `@glrs-dev/glorious-ask-user`.

Nothing changes at runtime. The extension loads under the same name, registers the same tool, and still withholds itself in print mode where there is nobody to answer.

The bundled roster had no test at all — three hardcoded static imports that nothing asserted actually loaded, so a move like this one was caught only by running the app. It has two now: every shipped extension loads without a failure, and each reports the origin it is supposed to. The louder failure was already covered by accident, since a path that stops resolving takes the whole suite down with it; these cover the quiet one, where an entry resolves but is wired to the wrong name.

Also fixes a doc path that still pointed at `v2/bundled/ask-user.ts`, from before the monorepo move.
