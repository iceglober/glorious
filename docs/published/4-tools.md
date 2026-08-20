---
title: tools
---

# tools

six tools reach your machine: `bash`, `read`, `write`, `edit`, `grep`, `glob`.
none of them is built in. they arrive from the `builtins` extension and register
through `g.tool` exactly as yours would, same gate, same result cap, same
transcript rows, and a tool name is kept by whoever claims it first, so a `bash`
in `.glrs/extensions/` replaces this one rather than racing it.

## permissions

tools run with the permissions of the process that launched glrs. there is no
sandbox and no approval prompt: a confirmation dialog is not a security boundary
once a model can edit files and run commands. containment is the containment a
developer already has, a branch, a worktree, a container, an account with the
rights you meant to grant.

the same reasoning is why the five tools that take a path, `read`, `write`,
`edit`, `grep`, `glob`, do not police it. relative paths resolve against the
project root, absolute paths are taken as given, and nothing is refused. `bash`
sits unconfined beside those five, so a path check there never bounded what the
agent could touch, it only made the model reach a file the slow way after being
told no on the direct one.

other pages point here rather than restating it.

## bash

runs `bash -lc <command>` in the project root, a login shell, so your profile
is read, and returns stdout, then stderr, then `[exit N]` when the command
fails. a command that succeeds and prints nothing still comes back as
`[exit 0]`; a bash result is never empty.

it is killed at the deadline: SIGTERM to the whole process group, SIGKILL five
seconds later if anything is still there. an interrupt (Esc) kills the same way
and the result reads `[interrupted]`; a deadline reads `[timed out after 600s]`,
the number being whatever `toolTimeoutMs` is, in seconds.

stdout is capped at 20,000 characters and stderr at 9,000, separately from and
earlier than the 30,000-character cap every tool result passes through, so a
long build log is already shortened before the general cap ever sees it.

one sharp edge: the description the model reads says "Commands are killed after
10 minutes" whether or not you configured something else. `toolTimeoutMs` moves
the deadline; it does not move that sentence.

## read

returns the file as UTF-8, each line prefixed with `N|`, its 1-based line
number. the prefix is display-only, and both `read` and `edit` say so in their
descriptions, because writing it back is the mistake numbering invites.

every result also carries whatever rules apply to the file's own directory,
appended under an `AGENTS.md guidance:` heading: the machine-wide and user files,
then every directory from your home directory down to the one being read, nearest
last. so reading `packages/web/src/app.ts` delivers `packages/web/AGENTS.md` even
when the session started at the repo root and never saw it. `AGENTS.md`,
`AGENT.md` and `CLAUDE.md` are read in that order, first found per directory.

## write

replaces the whole file, creating parent directories as needed. there is no
partial form, that is `edit`.

## edit

one call carries a batch of files, each with its own edits, applied in order,
each against the result of the previous one in that file. every edit in every
file is resolved before anything is written, so a failure anywhere leaves the
whole tree untouched, and each file is written beside itself and renamed into
place, so a reader sees either the old file or the new one.

`old_string` must match exactly, whitespace included, and occur exactly once
unless `replace_all` is set. this is the contract models get wrong most often, so
the refusal spells out the way out:

```
edit 2/2: old_string occurs 4 times. Nothing was written. Add surrounding lines to make it unique, or set replace_all.
```

edits are numbered within their file, and a call carrying more than one file says
which: `file 2/3 (src/app.ts) edit 1/1: …`. any edit after the first in a file
names the likely reason it stopped matching, `old_string not found, after the
earlier edits in this call were applied`.

## grep and glob

both are ripgrep. both respect `.gitignore` and never look inside `.git`;
`includeIgnored` turns off the first and reaches hidden files as well.

`grep` searches contents with a regex and returns matching lines as
`path:line:text`, paths absolute. it takes `pattern`, `path`, `glob` to restrict
which files are searched, `ignoreCase`, `fixedString` to match literally,
`includeIgnored`, and `maxResults`, 100 by default, 500 at most.

`glob` lists files matching a pattern, most recently modified first, with paths
relative to the searched directory. it takes `pattern`, `path`, `includeIgnored`
and `maxResults`, 200 by default, 1000 at most.

past the limit the last line reads `[truncated at 100 matches]` or
`[truncated at 200 files]`, the number is the `maxResults` in force.

## the timeout

`toolTimeoutMs` is the kill deadline for the three tools that spawn a process,
`bash`, `grep`, `glob`, and is ten minutes when unset.

```json
{ "toolTimeoutMs": 120000 }
```

`GLRS_TOOL_TIMEOUT_MS` (or `GLORIOUS_TOOL_TIMEOUT_MS`) beats the config file when
it parses as a finite number above zero. `read`, `write` and `edit` spawn nothing
and have no deadline. neither setting reaches `!` shell mode in the composer or
`g.exec` in an extension, those are ten minutes, fixed.

## withholding a tool

`tools.disable` names tools the model never sees, whichever extension registered
them:

```json
{ "tools": { "disable": ["bash", "web_fetch"] } }
```

the list is unioned across all three config scopes rather than taken from the
nearest, turning something off is the direction that has to be safe, so a
cloned project cannot re-enable what your User config switched off. the scopes
themselves, and the shorthand `"tools": ["bash"]`, are in
[configuration](./6-configuration.md).

a withheld tool is absent from the list the model is given, not refused when
called. a tool that does not exist cannot be talked into being used.

an extension narrows the same predicate list through `g.filterTools`, and every
filter has to agree before a tool is offered, so config and extension intersect
rather than one overwriting the other. the narrower instrument is the `tool_call`
hook, which reads the arguments and refuses a single call, see
[extensions](./8-extensions.md) for both.

## allowed-tools

a skill's `allowed-tools` is enforced, and the `activate_skill` call is what
enforces it: the model reaching for a skill installs a filter for the rest of the
turn, while typing the skill's slash command sends its body with nothing narrowed.
the transcript says what was narrowed:

```
(reviewer limits this turn to: activate_skill, glob, grep, read)
```

`activate_skill` is always added to the allowed list, so a skill with a narrow one
cannot trap the model inside itself. the filter joins the ones already there
rather than replacing them: a skill that permits `bash` does not resurrect a
`bash` your config disabled. it lifts when the turn goes idle, and a second
activation replaces the first rather than adding to it, except under `-p`, where
a run is one turn: nothing lifts, so two skills in one run leave the model held to
the intersection of both lists.

## tools that arrive with extensions

| tool | comes from | present when |
| --- | --- | --- |
| `web_fetch` | `web-fetch` | the extension is in `extensions.load` |
| `ask_user` | `ask-user` | the extension is loaded **and** there is a UI |
| `activate_skill` | the agent | at least one skill is offered to the model |
| `configure_extension` | `builtins` | a first-party extension is neither loaded nor disabled |

`web_fetch` takes up to ten URLs at once and returns each page's main content as
markdown, `http` and `https` only. it renders with headless Chrome when one is
installed, so a page that builds itself in JavaScript still arrives as text, and
falls back to a plain fetch when Chrome is absent. a URL that redirects to a
different host is reported rather than followed. results are cached for fifteen
minutes.

`ask_user` puts up to twenty questions, each with one to ten selectable options,
and waits; the user can choose an option, add a note, or both. it registers only
where somebody can answer: in print mode there is nothing to capture the screen
from, so the tool is withheld rather than left to hang on a question nobody will
see.

`configure_extension` exists only while some first-party extension is undecided,
named in neither `extensions.load` nor `extensions.disable`, and it is described
to the model as a way to record an answer the user has already given, never a
decision of its own. it writes only where `agentConfigAllowlist` permits, and
otherwise hands back the config line to add by hand;
[extensions](./8-extensions.md) has that side of it.

## what comes back

every tool result, from every extension, is capped at 30,000 characters and ends
in `[truncated, N chars omitted]` when it was longer. a throw becomes an
`ERROR: …` string handed to the model rather than a failed turn, it reads what
went wrong and chooses something else.

that is what a turn does from inside. the other way to start one is from a
shell: [command line](./5-cli.md).
