---
"@glrs-dev/glrs": minor
---

`@` finds directories, searches the whole tree, and scrolls.

Three separate limits made `@` less useful than it looked:

- **It only ever offered files.** A directory was never a candidate, and one typed by hand was reported missing. `@src` now attaches the listing of what is under it — the paths, not the contents, which is what lets the model pick what to read without a directory costing the context window.
- **It stopped searching early.** The old hand-walk gave up at six levels deep and after 400 entries — whichever 400 `readdir` reached first — so a file plainly visible in an editor did not exist as far as `@` was concerned. It uses ripgrep now, which ships with glorious already: no depth limit, `.gitignore` respected, and one listing cached across the burst of keystrokes that makes up a query.
- **It capped at 8 matches with no way past them.** The list painted every match and sized the panel to fit, which was only survivable because of the cap. It shows a scrolling window now, with `↑ n above · ↓ n more` so there is a reason to press down.

Ranking changed with it. Sorting by depth first put `test/a/b/util-helper.ts`
above `src/utils.ts` for `util`, because it ranked where a file sits over what it
is called. A name that starts with what you typed wins, then a name that contains
it, then everything else.
