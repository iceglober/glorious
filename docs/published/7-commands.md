---
title: commands, skills and rules
---

# commands, skills and rules

three things change what glrs does without a line of code: a markdown file that
becomes a slash command, a directory holding a `SKILL.md`, and an `AGENTS.md`.
they are read from disk at startup, they need no build step, and the first two
share one discovery rule.

## the discovery rule

commands are read from `.glrs/commands/` in the project, then from
`<User>/commands/`. skills have five roots, listed further down, and follow the
same rule: Project before User, first directory to claim a name keeps it. a
Project `/review` replaces a User one for this project rather than both
appearing. nothing is inherited from arbitrary parent directories, a checkout
sitting under another project does not pick up its commands.

`<User>` is the one user directory that also holds config, extensions and
skills; [configuration](./6-configuration.md) resolves it.

`/reload` re-reads all of it, commands, skills, extensions, and the `extensions`
and `tools` blocks of config, without restarting. nothing else in config is
re-read: the model a session started with is the model it keeps, unless an
extension changes it through `g.setModel`.

## the eight commands

| command | what it does |
| --- | --- |
| `/help` | commands, keys, and any flags extensions registered |
| `/skills` | every skill loaded, where it came from, and whether the model can see it |
| `/extensions` | what loaded and what it contributed, then what ships but is not on |
| `/clear` | drop the conversation the model replays; the transcript stays on screen |
| `/reload` | re-read extensions, skills and commands from disk |
| `/compact` | summarise the conversation so far so it can keep going |
| `/fork` | copy this session to a new id, so you can branch and come back |
| `/session` | this session's id, context, tokens, cost, event count and file |

none of them are built in. the core registers no commands at all; all eight
arrive from the bundled `builtins` extension through the same API a third party
gets. replacing one is a matter of taking that extension's name: a `builtins.ts`
in `.glrs/extensions/` loads in its place, and costs the six tools along with the
commands, glrs says so at startup rather than leaving the model with nothing to
call. registering `help` a second time is not a replacement. command names are
not first-claim-kept the way tool names are: the listing keeps the first
registration, the last one is what actually runs, and files on disk are walked
before anything bundled.

`/compact` takes an optional instruction: `/compact keep the migration details`.
`/fork` takes an optional event count, so `/fork 40` copies the first forty
events rather than all of them, and prints the `glrs --resume <id>` line for the
copy. `/clear` refuses while a turn is running and says so. slash commands are a
TUI feature: `glrs -p` has no composer and routes none of them, though skills
still load there and the model can still activate them.

### enabling an extension from the composer

`/extensions enable web-fetch` and `/extensions disable web-fetch` record the
answer in the Project `.glrs/config.json`: the name goes into `extensions.load`
or `extensions.disable` and comes out of the other list, so answering the
opposite way later actually changes the answer. it applies after a reload or
restart.

this works only for first-party extensions, and only when config carries
`"agentConfigAllowlist": ["extensions"]`, without it the command says glrs may
not write your config and names the line to add.
[extensions](./8-extensions.md) has the rest of it.

## markdown commands

a `.md` file in a commands directory becomes `/name`, lowercased from the
filename, so `Review.md` and `review.md` both answer to `/review`. empty files
are skipped. `.glrs/commands/review.md`:

```markdown
---
description: review the working diff for anything that would fail CI
---

read `git diff` and report anything that would fail CI. do not fix it yet.
```

the body is the prompt; the description is what `/help` and the completion menu
show.

**the frontmatter must open with `---` on the very first line.** a file starting
with a comment, a heading, or a blank line has no frontmatter at all: the
description falls back to `Run the review command`, and the whole file,
`description:` line and all, is what reaches the model. a file with no
frontmatter is legal, the whole file being the prompt, which is why this fails
quietly rather than refusing to load.

## arguments

everything after the command name travels with it. `$ARGUMENTS` expands to all
of it, trimmed. `$1` through `$9` expand one whitespace-separated word each, and
a digit past the end expands to nothing. a body that interpolates neither still
receives the arguments, appended in an `<arguments>` block: dropped,
`/graphify some/path` would silently lose the path, and appended bare, a trailing
`.` after 32kB of instructions is indistinguishable from a stray character.

## skills

a skill is a directory with a `SKILL.md` in it. glrs loads every name and
description at startup and lists them in the per-turn message; the body arrives
only when the model calls `activate_skill` with the name, or when you type the
skill's own command. a skill costs its name and description on every turn and its
body only on the turn that needs it.

`.glrs/skills/changelog/SKILL.md`:

```markdown
---
name: changelog
description: write release notes from commits. use when asked for a changelog or release notes.
allowed-tools: read, grep, glob
---

read commits since the last tag with `git log`. group them by user impact.
```

paths in the body resolve from the skill directory, which is handed to the model
alongside it.

every skill also answers to `/skill:changelog`. the prefix is not optional:
without it, installing a skill could quietly shadow a `/deploy` you already had,
with no way to look at the name and tell which of the two it was. `trigger:`
renames the part after the colon, and fuzzy completion means typing `/deploy`
still finds `/skill:deploy`.

### frontmatter

| field | meaning |
| --- | --- |
| `name` | required. lowercase letters, numbers and single inner hyphens, up to 64 |
| `description` | required. what it does and when to use it |
| `allowed-tools` | the tools this skill may use, comma- or space-separated |
| `trigger` | renames the command after `skill:` |
| `disable-model-invocation` | `true` (or `yes`, `1`, `on`) hides the skill from the model entirely |
| `license` | carried in the skill summary rather than acted on; an extension can read it |
| `compatibility` | same, and over 500 characters warns |
| `metadata` | arbitrary key/value pairs, indented under `metadata:` |

unknown fields are ignored rather than rejected, so a skill written for another
agent loads here. block scalars (`|`, `|-`, `>`, `>-`) are accepted for any of
the fields above.

`disable-model-invocation` is a convention several agents grew independently
rather than part of the Agent Skills standard. glrs honours it: the skill is
absent from the catalogue and from `activate_skill`, reachable only by typing its
command, and `/skills` tags it `you only`.

### allowed-tools is enforced

it is not documentation. the `activate_skill` call installs a tool filter for
the rest of that turn, the transcript says what was narrowed
(`(changelog limits this turn to: …)`), and anything outside the list is
withheld from the model until the session goes idle. typing the skill's own
command sends its body with nothing narrowed, the model reaching for a skill is
what arms the filter. [tools](./4-tools.md) has how it composes with
`tools.disable`, why `activate_skill` is always kept, and what `-p` does with it.

### where skills are found

five roots, in this order:

1. `.glrs/skills/`, Project, glrs's own
2. `.agents/skills/`, Project, portable
3. `<User>/skills/`, User, glrs's own
4. `~/.config/agents/skills/`, User, portable (`$XDG_CONFIG_HOME/agents/skills`
   when set)
5. the `skills/` directory of every extension that would load

the fifth is appended last on purpose: a project or personal skill of the same
name still beats one that arrived with an extension. which extensions would load
is worked out without running any of them, which is what lets skills load at
startup while extensions load much later.

each root is searched recursively, grouping skills into folders is how anyone
with more than a handful organises them, through the root and four levels of
directories under it, because a skills root is a place someone put skills, not
somewhere to go hunting through a checkout. `node_modules`, `.git`, `scripts`,
`references` and `assets` are never entered, and a directory holding a `SKILL.md`
is not searched further: its `references/` and `scripts/` are that skill's own
material.

### what warns, and what refuses

a skill that fails to load says so rather than disappearing. warnings print at
startup as `(skill) …` and again on every `/reload`, which is when a file was
just edited and its mistakes matter most.

four things stop a skill loading: no `---` at the top, frontmatter never closed,
no `name`, no `description`, a skill nothing can choose is not a loaded skill.
the rest warn and load anyway: a name over 64 characters or outside the
standard's shape, a folder named differently from the frontmatter (a rename, not
a mistake worth refusing over), a `compatibility` over 500 characters, and a
`description` over 1024, which reports its own length because that length is paid
for on every turn. two skills sharing a name: the first root to claim it wins,
and the warning names both paths.

## rules

in each directory glrs reads the first of `AGENTS.md`, `AGENT.md`, `CLAUDE.md`
that exists. the full order, nearest last:

1. `/etc/ampcode/AGENTS.md`, then `/Library/Application Support/ampcode/AGENTS.md`
   on macOS; `%ProgramData%\ampcode\AGENTS.md` on Windows
2. the same pair for glrs, `/etc/glrs/AGENTS.md`,
   `/Library/Application Support/glrs/AGENTS.md`, `%ProgramData%\glrs\AGENTS.md`
3. `~/.config/amp/AGENTS.md`, then `~/.config/glrs/AGENTS.md`, then
   `~/.config/AGENTS.md`
4. every directory from `$HOME` down to the file being read

glrs's own machine-wide files are read after amp's, so an administrator
installing rules for glrs has them win. for a project outside `$HOME` the walk
starts at the filesystem root instead. each path is read once, empty files
contribute nothing, and the closest file has the last word.

rules are fenced into the system prompt itself, as `<repo-rules>`. everything
else volatile (environment, git state, skills, extensions) rides in the
per-turn message so the prefix stays byte-identical and the provider's cache
holds. rules are the exception, so two projects produce two different system
prompts.

the same chain rides on every `read`: the file's own directory is resolved
separately and appended to the tool result under `AGENTS.md guidance:`, so a rule
in `packages/api/AGENTS.md` reaches the model the moment it opens a file there,
whether or not that directory was on the path when the session started.

use rules for short standing instructions. use a skill for a procedure that
should be loaded only when it applies. when neither is enough, when the answer
needs a tool, a keybinding, a subcommand or a row on the screen, the answer is
an [extension](./8-extensions.md).
