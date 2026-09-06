---
"@glrs-dev/glrs": minor
---

Decide what 1.0.0 promises about the extension API.

Every member of `Glrs` is covered by semver from 1.0.0: a break is a major. Seven are marked `@beta` and may change in a minor — `forkSession`, `entryRenderer`, `history`, `messageRenderer`, `setLabel`, `switchSession`, `truncateHead`. They are the seven that appear on the generated API page and nowhere in the written docs: the ones advertised least and exercised least. TypeDoc renders the badge, so the promise is visible where the member is.

**`ModelInfo.missing` is optional now.** It arrived required and broke the model picker, which builds its own catalogue rows and suddenly had to supply a field glrs computes. A field added to a type an extension can construct is declared optional from here, so that learning something new about a model is an addition rather than a break. Absent and empty mean the same thing to a reader.

`ModelInfo` turned out to be the only public type an extension actually constructs. `Key` and `Verdict` are received and annotated, never built.
