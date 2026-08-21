---
title: quick start
---

# quick start

## install

```bash
curl -fsSL https://glrs.dev/install.sh | bash
```

the script requires git and offers to install Bun when it is missing. for
package managers, PATH fixes and uninstalling: [install](../2-how-to/1-install-and-update.md).

## set a provider key

```bash
export ANTHROPIC_API_KEY=...
```

## make a scratch repo

```bash
mkdir /tmp/glrs-tour && cd /tmp/glrs-tour && git init
printf 'hello\n' > greeting.txt
git add -A && git commit -m start
```

## take one turn

```bash
glrs --model anthropic/claude-opus-5
```

type this and press `enter`:

```text
rewrite greeting.txt so it greets this repository by name
```

glrs reads the file, edits it, and tells you what it changed.

## see the edit

press `ctrl+c` twice to leave, then:

```bash
git diff
```

## come back

```bash
glrs --model anthropic/claude-opus-5 --resume
```

arrows move, `enter` opens, `esc` cancels. the session picks up where it stopped.

## make the model stick

repeating `--model` gets old. the first run wrote `.glrs/config.json` for you;
add a model to it:

```json
{
  "$schema": "https://glrs.dev/config.schema.json",
  "model": "anthropic/claude-opus-5"
}
```

every later `glrs` in this project uses it. for every project, put the same line
in `<user config>/config.json`: [configuration](../9-reference/14-configuration.md).

next: [your first extension](./2-first-extension.md)

see also: [turns](../9-reference/6-turns.md), [keys](../9-reference/3-keys.md)
