---
"@glrs-dev/glorious": patch
---

The release workflow publishes whatever version main is at.

Three versions were bumped on main today and never reached npm — `next.25`,
`next.36`, `next.46` — each rolled over by the following release and lost.

The publish guard was already idempotent, but it only ran when
`changesets/action` chose to call it, and the action publishes nothing when it
sees an unconsumed changeset: it opens a version PR instead. So a version PR
whose branch predated the newest changeset would merge, bump `package.json` on
main, and publish nothing — stranding that version permanently.

The same guard now also runs as its own unconditional step. Every push to main
converges on "npm has what main says", so a skipped version is repaired by the
next push instead of being rolled over. The guard also confirms the registry
actually serves what it just published, rather than assuming, because the
dist-tag step after it would otherwise point `latest` at something nobody can
install.
