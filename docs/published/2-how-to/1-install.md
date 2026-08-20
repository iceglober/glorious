---
title: install
---

# install

```sh
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

## uninstall (sad)

```sh
bun remove -g @glrs-dev/glrs
rm -rf ~/.config/glrs ~/.local/share/glrs ~/.cache/glrs  # config, sessions, cache
```

## alt+enter steering on Windows Terminal

Windows Terminal takes the key for fullscreen and consumes it before glrs sees it. unbind it in `settings.json`, then restart glrs:

```json
{ "actions": [{ "command": "unbound", "keys": "alt+enter" }] }
```
