---
title: skills
---

# skills

a skill is a directory containing `SKILL.md`. glrs loads its name and
description at startup, then loads the body only when the skill is used.

```text
.glrs/skills/changelog/
  SKILL.md
  references/
  scripts/
  assets/
```

```yaml
---
name: changelog
description: write release notes from commits. use when asked for a changelog.
---

read commits since the last tag. group them by user impact.
```

paths in the body are relative to the skill directory.

## locations

searched in order:

| path | scope |
| --- | --- |
| `.glrs/skills/` | Project, glrs-specific |
| `.agents/skills/` | Project, portable |
| `<User>/skills/` | User, glrs-specific |
| `<config base>/agents/skills/` | User, portable |

first name wins. directories are searched recursively to depth four. once a
directory contains `SKILL.md`, its children are treated as skill resources, not
more skills.

`<User>` and `<config base>` are defined under
[configuration](../1-start/configuration.md).

## frontmatter

| field | meaning |
| --- | --- |
| `name` | required; 1–64 lowercase letters, numbers, and inner hyphens |
| `description` | required; what it does and when to use it |
| `license` | license name or file |
| `compatibility` | runtime requirements |
| `metadata` | arbitrary key/value data |
| `allowed-tools` | expected tools; displayed but not enforced |
| `trigger` | renames the command after `skill:` |
| `disable-model-invocation` | hides the skill from the model |

unknown fields are ignored. invalid optional fields warn and still load. a
missing name or description prevents loading.

folder and frontmatter names may differ; glrs warns but uses frontmatter.

## invoke

the model chooses from descriptions and calls `activate_skill`. you can run the
same body directly:

```text
/skill:changelog
```

arguments after the command are included with the instructions.

with `disable-model-invocation: true`, the skill is absent from the model's
catalog and `activate_skill`, but its slash command remains.

`disable-model-invocation` is a common convention, not part of the Agent Skills
specification.

## which mechanism

- **skill**: reusable instructions the model should choose
- **command**: a prompt only you invoke
- **extension**: executable TypeScript
