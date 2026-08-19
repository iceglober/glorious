---
"@glrs-dev/glrs": minor
---

Four places in the extension API where a reasonable extension got a wrong answer.

**`g.exec` reports the exit code and stderr.** It returned `{output, stdout, ok}`,
and `ok` collapsed every failure into one bit — exit 1 (the linter found
problems) and exit 127 (the linter is not installed) are opposite situations and
were indistinguishable. Now `{output, stdout, stderr, code, ok}`.

**`g.setTools` is replaced by `g.filterTools`.** It set one global list, so the
second extension to restrict tools silently undid the first and neither could
see the other. A filter is a predicate, every extension's filter has to agree,
and the handle it returns lifts yours and nobody else's. Restrictions now
compose and can only narrow.

**`g.entries(type)` reads back what `g.appendEntry` wrote.** There was no read
path at all: an extension could persist data into the session file and never
recover it except by opening `session().file` and parsing it itself. Entries
survive `--resume`, since a resumed session replays them.

**`g.print(content, tone)` honours `tone` for `Line[]`.** It only ever reached
`noticeBlock`, so a tone passed with spans was silently dropped. Spans that name
their own tone keep it; the rest take the one you passed.
