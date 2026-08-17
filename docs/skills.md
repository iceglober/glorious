# Skills

A skill is a directory with a `SKILL.md` in it. The frontmatter says what it is
called and when to use it; the body is what to do. Only the name and description
are loaded at startup — the body arrives when the skill is actually used, so a
long skill costs nothing until it is needed.

```
.glorious/skills/changelog/
  SKILL.md          the frontmatter and the instructions
  references/       detail the model reads only if it needs to
  scripts/          anything the skill runs
  assets/           templates, fixtures, data
```

```yaml
---
name: changelog
description: Write a release note from the commits since the last tag. Use when asked for a changelog or release notes.
---

Read the commits with `git log $(git describe --tags --abbrev=0)..HEAD`.
Group them by what a reader would care about, not by commit order.
```

Paths inside the body are relative to the skill's own directory, which glorious
tells the model when it loads the skill. That is what makes `references/` work:
put the detail there and mention the file, and it gets read only when it matters.

## Where they are found

Searched in this order; the first skill to claim a name wins, and a second one
with the same name says so rather than quietly losing.

| Path | Scope |
| --- | --- |
| `~/.config/agents/skills/` | you, everywhere |
| `~/.agents/skills/` | you, everywhere |
| `<any ancestor>/.agents/skills/` | shared, walking up to your home directory |
| `.glorious/skills/` | this project |

Directories are searched recursively, so grouping skills into folders works —
`skills/writing/changelog/SKILL.md` is the `changelog` skill. A directory that
contains a `SKILL.md` is a skill and is not searched any further, so its own
`references/` and `scripts/` are never mistaken for more skills.

Nothing reads another agent's directories. Symlink one in if you want it here.

## Frontmatter

| Field | |
| --- | --- |
| `name` | **required.** 1–64 characters, lowercase letters, numbers, single inner hyphens |
| `description` | **required.** Up to 1024 characters: what it does *and when to use it* |
| `license` | a licence name, or a file in the skill directory |
| `compatibility` | up to 500 characters on what it needs to run |
| `metadata` | any key/value mapping you like |
| `allowed-tools` | space-separated tools the skill expects. Parsed and shown; glorious does not yet restrict anything to it |
| `trigger` | glorious's own: renames the part after `skill:`. Without it that is the skill's name |
| `disable-model-invocation` | **not part of the standard** — see below |

The description is the whole of what the model sees until the skill is used, so
it has to say *when* to reach for the skill, not only what it does. It is paid
for on every turn of every session where the skill is installed.

Fields glorious does not recognise are ignored, so a skill written for another
agent loads here unchanged.

Validation is lenient and loud. A name with a capital in it, a description over
the limit, a directory whose name no longer matches the skill — each warns in
the transcript and loads anyway. Only a missing name or description stops a
skill loading, because a skill nothing can describe is one nothing can choose.
A skill that fails to load says so; it never just fails to appear.

## `disable-model-invocation`

```yaml
disable-model-invocation: true
```

The skill is not listed in the system prompt, is not reachable through
`activate_skill`, and costs nothing per turn. It stays available to you as
`/skill:name`.

**This field is not in the Agent Skills specification.** It is a convention that
several agents arrived at independently, and it is now common enough that a
skill carrying it expects it to be honoured — so glorious honours it. Treat it
as a de-facto extension to the format rather than something the standard
promises, and do not be surprised if a tool that reads the specification
strictly ignores it.

## Using one

The model picks a skill by its description and loads it with `activate_skill`.
You invoke the same skill by typing `/skill:name`, with anything after the name
arriving as its arguments. Both paths run the same body.

The prefix is a namespace, not decoration. Skills used to take the bare
`/name`, which put them in the same table as every command an extension or a
markdown file registers — so installing a skill could quietly shadow a command
you already had, and looking at `/deploy` told you nothing about which of the
two it was. Completion is a subsequence match, so typing `/graphify` still finds
`/skill:graphify`; you do not have to type the prefix.

`/skills` lists what loaded, where each came from, and which are offered to the
model — a skill that opted out is tagged `you only`.

## Skills, commands, and extensions

- A **skill** is for the model: it decides when the skill applies. Reach for one when the *model* should know how to do something.
- A **command** (`.glorious/commands/*.md`) is for you: a prompt you send by typing `/name`. See `commands.md`.
- An **extension** is code — a tool, a hook, a widget. See `extensions.md`.

A skill that only ever gets used because you typed it is a command. A command
the model should reach for on its own is a skill.

Commands keep the bare `/name`; only skills are
namespaced, because they are the only ones that arrive from somewhere else.
