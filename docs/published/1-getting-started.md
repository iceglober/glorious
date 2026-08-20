---
title: getting started
---

# getting started

glrs is a terminal coding agent. you type a turn, it reads the repository, edits
files and runs commands, and it tells you what it did.

two things stand between a clean machine and a first turn, the program, and a
model to point it at. there is no default for the second.

## install

```sh
curl -fsSL https://glrs.dev/install.sh | bash
```

Bun is the one prerequisite the script will install for you: when `bun` is not
on PATH it asks, runs the installer from `bun.sh`, and re-checks. if Bun lands
somewhere your shell cannot see, the script stops and tells you to restart the
shell and re-run rather than installing on top of a broken PATH.

git is required and is never installed for you, a missing `git` ends the
script. `gh` is reported and nothing more; glrs works without it.

then `bun add --global @glrs-dev/glrs@next`, and a last check that `glrs`
answers. if it does not, the script points at `bun pm bin -g`, which prints the
directory your PATH is missing.

### package managers

```sh
bun add -g @glrs-dev/glrs@next
pnpm add -g @glrs-dev/glrs@next
yarn global add @glrs-dev/glrs@next
npm install -g @glrs-dev/glrs@next
```

all four still need Bun at runtime. `bin/glrs` is a POSIX `sh` shim that
resolves its own symlinks and ends in `exec bun …/src/index.ts "$@"`: glrs ships
as TypeScript and is never compiled, so whatever installed it, Bun runs it.

the package installs two executables, `glrs` and `glorious`, both pointing at
that shim. the rename kept the old name working, and `GLORIOUS_MODEL` still
answers for `GLRS_MODEL` when only the old one is set.

## set a model

there is no default model and no default provider. nothing runs until you name
one as `provider/model-id`:

```sh
export ANTHROPIC_API_KEY=...
export GLRS_MODEL=anthropic/claude-opus-5
```

until then anything that would call a model exits with `No model configured.
Set GLRS_MODEL="provider/model-id" or add "model" to glrs config.` on stderr.
`glrs doctor` is the one route that does not stop there, reporting that state
is its whole job.

each provider carries its own credential variables, and the first one set wins:

```sh
export OPENAI_API_KEY=...
export GLRS_MODEL=openai/gpt-5.6-sol
```

the provider half of `GLRS_MODEL` accepts aliases, so `claude/claude-opus-5`
and `bedrock/anthropic.claude-opus-4` both resolve; the model half is passed to
the provider verbatim. all fifteen providers and their credential variables,
the two that authenticate through a cloud credential chain instead of a key,
OpenAI-compatible endpoints and the config-file equivalent of `GLRS_MODEL` are
in [models and providers](./2-models.md).

## the first session

from inside a git repo:

```sh
glrs
```

type a turn into the composer and press enter. glrs reads and edits files,
searches the repo and runs shell commands with the permissions of the process
that launched it. the first run in a git repo creates whichever of these are
missing: `.glrs/config.json`, `.glrs/config.local.json`, a `.glrs/.gitignore`
that keeps the local copy out of the repository, and the User config file.

`ctrl+c` on an empty composer interrupts the running turn and arms the exit for
three seconds; a second `ctrl+c` inside that window leaves. with text in the
composer it clears the line instead. on the way out glrs prints the line that
brings the session back:

```
Continue with: glrs --resume 4f8b1c2d
```

`glrs --resume` with no id opens a picker over earlier sessions.

the composer, the two message queues, `@path` mentions, `!` shell lines and
what every row on the screen is telling you are in
[the session](./3-session.md); the six tools glrs reaches your machine with are
in [tools](./4-tools.md).

## check the setup

`glrs doctor` resolves everything a session would need and runs none of it:

```
model: anthropic/claude-opus-5
provider: Anthropic
missing: ANTHROPIC_API_KEY
extensions: builtins (bundled)
```

set the key and that third line becomes `credentials: found`. with nothing
configured at all, doctor names the gap and lists the fifteen provider ids it
would accept, and `glrs doctor --json` prints the same report as an object.
[models and providers](./2-models.md) reads the report line by line.

## update

```sh
glrs update
```

that runs `bun add -g @glrs-dev/glrs@next` and nothing else, it goes through
Bun whatever manager installed glrs. if you installed with pnpm, yarn or npm,
re-run that manager's install command instead, or you end up with two copies and
PATH order decides which one you get.

## uninstall

```sh
bun remove -g @glrs-dev/glrs
pnpm remove -g @glrs-dev/glrs
yarn global remove @glrs-dev/glrs
npm uninstall -g @glrs-dev/glrs
```

removing the package removes the program and nothing else. three things stay
behind:

| data | default path | moved by |
| --- | --- | --- |
| config, extensions, commands, skills | `~/.config/glrs` (Windows: `%APPDATA%\glrs`) | `GLRS_CONFIG_HOME`, `XDG_CONFIG_HOME` |
| sessions | `~/.local/share/glrs/sessions` | `XDG_DATA_HOME` |
| models.dev catalogue cache | `~/.cache/glrs/models.dev.json` | `XDG_CACHE_HOME` |

sessions and the cache use those XDG paths on every platform, Windows included.
each repository also keeps its own `.glrs/` directory, which goes with the
repository. history from before the rename lives in
`~/.local/share/glorious/sessions` and migrates itself a session at a time, so
deleting only the `glrs` directory leaves the older half behind,
[the session](./3-session.md) has the rest of that.
