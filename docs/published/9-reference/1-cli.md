---
title: cli
---

# cli

`glrs` and `glorious` are the same command: `bin/glrs`, a shell script that follows its own symlinks, then execs `bun packages/glrs-coding-agent/src/index.ts`.

## classification

argv is read once, before anything loads. first match wins:

1. `--version` or `-v` anywhere
2. `--help` or `-h` anywhere
3. the first bare word, when it is neither `doctor` nor `update` and no `-p` precedes it: a subcommand, handed the rest of the line
4. `update`, then `doctor`, which accepts only `--json`
5. `--model`, checked for a value
6. `-p` or `--print`: one headless turn. otherwise: an interactive session

a bare word is the first token that neither starts with `-` nor follows one that does. everything after `-p` is joined with spaces and taken verbatim; only what precedes `-p` is parsed.

| invocation | runs |
| --- | --- |
| `glrs wt -p hi` | the `wt` subcommand, handed `-p hi` |
| `glrs -p wt list` | one turn on the prompt `wt list` |
| `glrs wt doctor` | the `wt` subcommand, handed `doctor` |
| `glrs -p run it -v` | the version |

## flags

| flag | effect |
| --- | --- |
| `-p, --print <prompt>` | one headless turn; reads piped stdin too |
| `--model <provider/id>` | model for this run, written to `GLRS_MODEL` before anything reads it |
| `--resume [session-id]` | resume that session, or open the picker when given no id |
| `--version`, `-v` | print `glrs <version>` |
| `--help`, `-h` | print the usage, the commands, the options, and an `Added by extensions:` block |

`--model` must have a value, that value must not be another flag, and it must name a provider:

```text
glrs --model           → --model needs a value.
glrs --model -p hi     → --model needs a model id, and "-p" is another flag.
glrs --model bare-id   → --model bare-id: --model needs provider/model-id, and "bare-id" names no provider. There is no default provider. See `glrs doctor`.
```

`--resume <id>` naming no session is `Session not found: <id>`; an empty store is `No sessions to resume.`

a long flag glrs does not know is lifted out before parsing, lowercased, and handed to the extension that registered it. `--foo=x` and `--foo bar` carry a value; `--foo --bar` carries `""`. an unclaimed flag is the notice `(unknown flag: --foo)`. interactive sessions only.

## subcommands

a first bare word glrs does not claim is offered to the extensions, which load to answer. no session, no model, no alternate screen. `g.print` goes to stdout undecorated, and session-only members of the extension API throw. an unclaimed word is `Unknown subcommand 'x'.` plus the help text, exit 1.

`--help` is the only other route that loads extensions. `update` runs `bun add -g @glrs-dev/glrs@next` with its output attached.

## print mode

assistant text goes to stdout. the tool trail, retries, extension notes and `[config]` diagnostics go to stderr. piped stdin joins the prompt, fenced as `<input>…</input>`. nothing reaches the session store. `g.columns()` reads `COLUMNS`, else 100.

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
