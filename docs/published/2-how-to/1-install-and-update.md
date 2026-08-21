---
title: install & update
---

# install & update

## install script (recommended)

```bash
curl -fsSL https://glrs.dev/install.sh | bash
```

requires git. Bun is the runtime, and the script offers to install it when it is
missing.

if `glrs` is not found afterward, add the directory printed by `bun pm bin -g`
to PATH.

## package managers

glrs ships on the `next` tag. every manager below installs the same package.

| manager | install | update | uninstall |
| --- | --- | --- | --- |
| bun | `bun add -g @glrs-dev/glrs@next` | `bun update -g @glrs-dev/glrs` | `bun remove -g @glrs-dev/glrs` |
| pnpm | `pnpm add -g @glrs-dev/glrs@next` | `pnpm update -g @glrs-dev/glrs` | `pnpm remove -g @glrs-dev/glrs` |
| npm | `npm i -g @glrs-dev/glrs@next` | `npm update -g @glrs-dev/glrs` | `npm uninstall -g @glrs-dev/glrs` |
| yarn | `yarn global add @glrs-dev/glrs@next` | `yarn global upgrade @glrs-dev/glrs` | `yarn global remove @glrs-dev/glrs` |

## glrs update

```bash
glrs update
```

reinstalls the latest release with Bun. if you installed with npm, pnpm or yarn,
that leaves their copy in place and Bun's on PATH; use your own manager's update
command instead.

## uninstall

remove the package with your manager from the table above, then the data it
left:

```bash
rm -rf "${XDG_CONFIG_HOME:-$HOME/.config}/glrs"    # configuration
rm -rf "${XDG_DATA_HOME:-$HOME/.local/share}/glrs" # sessions and prompt history
rm -rf "${XDG_CACHE_HOME:-$HOME/.cache}/glrs"      # the model catalogue
```

configuration and the catalogue can be recreated. sessions cannot.

next: [quick start](../1-tutorials/1-quick-start.md), [connect a provider](./2-connect-a-provider.md), [cli](../9-reference/1-cli.md)
