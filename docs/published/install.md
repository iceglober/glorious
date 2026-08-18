# Install

## Recommended

```sh
curl -fsSL https://glrs.dev/install.sh | bash
```

The installer checks for Bun and git, offers to install Bun when missing, and
installs the current `next` release.

## Package manager

```sh
bun add --global @glrs-dev/glorious@next
```

The package requires Bun 1.3.14 and git.

## First run

```sh
export AZURE_OPENAI_API_KEY=…
export AZURE_RESOURCE_NAME=…
glorious
```

Continue with the [Quickstart](./quickstart.md).

## Update

```sh
glorious update
```

## Uninstall

```sh
bun remove --global @glrs-dev/glorious
```
