---
title: cli
---

# cli

`glrs` is short for glorious. both names run the same binary, so use whichever
you prefer.

## project root

everything resolves against the project root: file tools, config discovery,
[rules](./10-rules.md). it is `git rev-parse --show-toplevel`, or the directory
you started in when that is not a repository.

glrs works outside a repository. the first run still writes config, and the file
tools still resolve against where you started.

## commands

| command | does |
| --- | --- |
| `glrs` | open a session |
| `glrs -p <prompt>` | one headless turn, then exit |
| `glrs doctor` | report what would run, without running it |
| `glrs update` | reinstall the latest release |
| `glrs <word>` | a [subcommand](./13-subcommands.md) an extension registered |

`--version` and `--help` win wherever they appear. everything after `-p` is the
prompt, taken verbatim, so it may contain what looks like a flag. a subcommand
before `-p` wins; `-p` before a bare word wins.

## flags

| flag | effect |
| --- | --- |
| `-p, --print <prompt>` | one headless turn; reads piped stdin too |
| `--model <provider/id>` | model for this run, written to `GLRS_MODEL` before anything reads it |
| `--resume [session-id]` | resume that session, or open the picker when given no id |
| `--version`, `-v` | print `glrs <version>` |
| `--help`, `-h` | print the usage, the commands, the options, and an `Added by extensions:` block |

`--model` must have a value, that value must not be another flag, and it must name a provider:

```bash
glrs --model           → --model needs a value.
glrs --model -p hi     → --model needs a model id, and "-p" is another flag.
glrs --model bare-id   → --model bare-id: --model needs provider/model-id, and "bare-id" names no provider. There is no default provider. See `glrs doctor`.
```

`--resume <id>` naming no session is `Session not found: <id>`; an empty store is `No sessions to resume.`

a long flag glrs does not know is lifted out before parsing, lowercased, and handed to the extension that registered it. `--foo=x` and `--foo bar` carry a value; `--foo --bar` carries `""`. an unclaimed flag is the notice `(unknown flag: --foo)`. interactive sessions only.

## subcommands

a first bare word glrs does not claim goes to the extensions: [subcommands](./13-subcommands.md).

## print mode

assistant text goes to stdout. the tool trail, retries, extension notes and `[config]` diagnostics go to stderr. piped stdin joins the prompt, fenced as `<input>…</input>`. nothing reaches the session store.

| exit | when |
| --- | --- |
| `0` | the turn finished |
| `1` | the turn threw, SIGINT interrupted it (`[interrupted]`), the 100-step limit was reached (`[stopped at the step limit without finishing]`), an argv error, an unknown subcommand, or `Nothing to run: -p needs a prompt or piped input.` |

## doctor

`glrs doctor` reports what would run without running any of it: extensions are resolved, not loaded.

```text
model: anthropic/claude-opus-5
provider: Anthropic
missing: ANTHROPIC_API_KEY
extensions: builtins (bundled)
```

with credentials present the third line is `credentials: found`. with no model the first is `model: not configured`, followed by the reason and the built-in provider ids. `--json` emits the same report as an object: `diagnostics`, `model`, `provider`, `missing`, `note`, `extensions`.

see also: [models](./4-models.md), [configuration](./14-configuration.md), [run in a pipeline](../2-how-to/9-run-in-a-pipeline.md)
