# published documentation

Four groups, [Diataxis](https://diataxis.fr): tutorials, how-to, explanation,
reference. One type per page. A tutorial that explains has stopped being a
tutorial; link out instead.

Accuracy is held by the test suite, not by a document beside the docs:

- `prompt.test.ts` asserts every path the system prompt names resolves under
  `docsPath()`.
- `extension-api.test.ts` counts the event rows in `9-reference/8-events.md`
  against the `EventName` union.

Both exist because this directory is read twice. The docs site builds from it,
and `prompt.ts` points glrs at it instead of at source. A wrong sentence here
becomes a wrong extension later.

`9-reference/` is numbered to match `docs-site/generated/9-reference/`, so the
two merge into one nav group.
