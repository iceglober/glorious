---
title: have glrs write the extension
---

# have glrs write the extension

glrs is given its own documentation and told to write an extension when asked
for something it cannot do. you will ask for a capability it lacks and watch it
build one.

## set up a scratch repo

```bash
mkdir /tmp/glrs-tour && cd /tmp/glrs-tour && git init
printf 'hello\n' > greeting.txt
git add -A && git commit -m start
```

## ask for something it cannot do

```bash
glrs --model anthropic/claude-opus-5
```

type this:

```text
add a /branches command that lists this repo's branches with their last commit date
```

there is no `/branches` command and no tool that lists branches.

## watch what it reads

it reads its own documentation before writing anything:

```text
read   9-reference/11-extensions.md   142 lines
read   1-tutorials/2-first-extension.md   70 lines
write  .glrs/extensions/branches.ts
```

those paths are under glrs's install directory, not your project.

## check the file

```bash
cat .glrs/extensions/branches.ts
```

a `g.command()` call, a `g.exec()` for the git work, and a default export.

## use it

```text
/reload
/branches
```

`/reload` re-reads extensions without restarting.

## why this works

the system prompt names nine documentation pages and tells the model to read
them when asked about glrs itself. the documentation is the contract it writes
against, which is why it is kept accurate and why it does not point at source.

next: [design](../3-explanation/1-design.md), [extensions](../9-reference/11-extensions.md)
