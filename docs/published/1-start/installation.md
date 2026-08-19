---
title: installation
---

# installation

## prerequisites

- git
- [Bun](https://bun.sh)

## install script (recommended)

```sh
curl -fsSL https://glrs.dev/install.sh | bash
```

the script checks for git and offers to install Bun when it is missing.

## package manager

```sh
bun add -g @glrs-dev/glrs@next
pnpm add -g @glrs-dev/glrs@next
yarn global add @glrs-dev/glrs@next
npm install -g @glrs-dev/glrs@next
```

all package-manager installs still require Bun at runtime.

get started with [quickstart](./quickstart.md) or open
[configuration](./configuration.md).

## update

```sh
glrs update
```

this installs the newest `next` release. the equivalent package-manager command
is:

```sh
bun add -g @glrs-dev/glrs@next
```

or rerun the matching package-manager install command above.

## uninstall (sad)

```sh
bun remove -g @glrs-dev/glrs
pnpm remove -g @glrs-dev/glrs
yarn global remove @glrs-dev/glrs
npm uninstall -g @glrs-dev/glrs
```

uninstalling the package leaves User config and session history in place.
remove them separately only when you want the data gone:

| data | macOS and Linux default | Windows default |
| --- | --- | --- |
| config and resources | `~/.config/glrs` | `%APPDATA%\glrs` |
| sessions | `~/.local/share/glrs` | `~/.local/share/glrs` |
| model cache | `~/.cache/glrs` | `~/.cache/glrs` |

`GLRS_CONFIG_HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, and `XDG_CACHE_HOME`
can move those directories.
