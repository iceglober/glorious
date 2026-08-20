---
title: write a command
---

# write a command

a markdown file becomes a slash command. glrs has three kinds: native ones that
ship, markdown ones you write, and skills, which answer to `/skill:name`. see
[commands and skills](../9-reference/6-commands-and-skills.md).

## write it

`.glrs/commands/review.md`:

```markdown
---
description: review the working diff
---

review the working diff for anything that would fail CI. pay attention to $ARGUMENTS.
```

## run it

```text
/review the migration
```

the filename is the name, lowercased. frontmatter is optional: without it the
whole file is the prompt.

## arguments

`$ARGUMENTS` is everything after the name. `$1` to `$9` are its words. a body
with no placeholder gets the arguments appended in an `<arguments>` block.

## make it available everywhere

put the file in `<user config>/commands/` instead of the project. on a name
clash the project wins. [configuration](../9-reference/5-configuration.md)
resolves `<user config>`.

`/reload` picks up a new file without restarting.

next: [write a skill](./5-write-a-skill.md)
