---
"@glrs-dev/glorious": minor
---

Skills answer to `/skill:name`.

They took the bare `/name`, which put them in the same table as every command an
extension or a markdown file registers — so installing a skill could quietly
shadow a command you already had, and looking at `/deploy` told you nothing
about which of the two it was. The prefix says where a command comes from.
`trigger:` now renames the part after the colon.

Completion is a fuzzy match, so typing `/changelog` still finds
`/skill:changelog` — the prefix does not have to be typed. Commands and
commands keep their bare names; skills are namespaced because they are the ones
that arrive from somewhere else.

A colon had to become legal in a command name for any of this to parse. It was
not, so `/skill:name` matched nothing and fell through to "unknown command".

Also fixes the skills tests, which searched the real home directory and so read
whatever skills were installed on the machine running them — green on CI, red on
any laptop with skills of its own. `loadSkills` takes the home directory as a
parameter now; `homedir()` ignores `$HOME` on Bun, so there was no way to point
it somewhere empty from a test.
