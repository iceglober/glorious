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
glrs
```

no model is set yet, so the picker opens. type to filter, `enter` chooses:

```text
? Choose model  7243/7243
  search: opus▏
› anthropic/claude-opus-5
```

models glrs has credentials for are listed first; the rest say what they want,
like `needs OPENAI_API_KEY`.

then type this and press `enter`:

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
glrs --resume
```

arrows move, `enter` opens, `esc` cancels. the session picks up where it stopped.

## make the model stick

picking one every launch gets old. the first run wrote `.glrs/config.json` for
you; add a model to it:

```json
{
  "$schema": "https://glrs.dev/config.schema.json",
  "model": "anthropic/claude-opus-5"
}
```

every later `glrs` in this project uses it, and the picker stays out of the way.
to let `/model` write that line itself, add `"agentConfigAllowlist": ["model"]`.
for every project, put `model` in `<user config>/config.json`:
[configuration](../9-reference/14-configuration.md).

next: [your first extension](./2-first-extension.md)

see also: [turns](../9-reference/6-turns.md), [keys](../9-reference/3-keys.md)
