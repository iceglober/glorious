---
title: install
---

# install

## install script

```bash
curl -fsSL https://glrs.dev/install.sh | bash
```

requires git, and Bun at runtime, package-manager installs included. the script offers to install Bun when it is missing.

if `glrs` is not found afterward, add the directory printed by `bun pm bin -g` to PATH.

## package managers

| manager | command |
| --- | --- |
| bun | `bun add -g @glrs-dev/glrs@next` |
| pnpm | `pnpm add -g @glrs-dev/glrs@next` |
| yarn | `yarn global add @glrs-dev/glrs@next` |
| npm | `npm i -g @glrs-dev/glrs@next` |

## update

`glrs update` reinstalls the latest `@next`.

## uninstall

```bash
bun remove -g @glrs-dev/glrs
rm -rf ~/.config/glrs ~/.local/share/glrs ~/.cache/glrs  # config, sessions, cache
```

## alt+enter steering on Windows Terminal

Windows Terminal claims `alt+enter` for fullscreen and consumes it before
glrs sees it. open its settings file with `ctrl+,` (**Settings**, then **Open
JSON file**) and unbind the key, then restart glrs:

```json
{ "actions": [{ "command": "unbound", "keys": "alt+enter" }] }
```

next: [quick start](../1-tutorials/1-quick-start.md), [connect a provider](./2-connect-a-provider.md), [cli](../9-reference/1-cli.md)
