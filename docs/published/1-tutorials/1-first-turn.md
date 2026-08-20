---
title: first turn
---

# first turn

## install

```sh
curl -fsSL https://glrs.dev/install.sh | bash
```

the script requires git and offers to install Bun when it is missing.

## name a model

```sh
export ANTHROPIC_API_KEY=...
export GLRS_MODEL=anthropic/claude-opus-5
```

## make a scratch repo

```sh
mkdir /tmp/glrs-tour && cd /tmp/glrs-tour && git init
printf 'hello\n' > greeting.txt
git add -A && git commit -m start
```

## take one turn

```sh
glrs
```

type this and press `enter`:

```text
rewrite greeting.txt so it greets this repository by name
```

glrs reads the file, edits it, and tells you what it changed.

## see the edit

press `ctrl+c` twice to leave, then:

```sh
git diff
```

## come back

```sh
glrs --resume
```

arrows move, `enter` opens, `esc` cancels. the session picks up where it stopped.

next: [your first extension](./2-first-extension.md), [keys](../9-reference/2-keys.md)
