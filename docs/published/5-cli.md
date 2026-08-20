---
title: command line
---

# command line

glrs starts three ways. `glrs` opens an interactive session.
`glrs -p "<prompt>"` runs one turn headless and exits. `glrs <command> [args]`
runs a subcommand an extension registered, which opens no session, calls no
model and never touches the alternate screen.

the package installs one executable under two names, `glrs` and `glorious`.

## which entry point you got

the arguments are classified once, before anything loads:

1. `-v` or `--version` anywhere → print the version and exit.
2. `-h` or `--help` anywhere → print help and exit.
3. the first bare word — the first token that neither starts with `-` nor
   follows one that does. if it is neither `doctor` nor `update`, and it comes
   before any `-p`, it is a subcommand and everything after it belongs to that
   subcommand.
4. `update` runs on sight; `doctor` is parsed on its own and takes only
   `--json`.
5. `--model` is checked for a value, before either remaining branch parses.
6. `-p` or `--print` present → one headless turn. otherwise → an interactive
   session.

between a subcommand and `-p`, position decides: whichever appears first in the
argument list wins.

| invocation | what runs |
| --- | --- |
| `glrs wt -p hi` | the `wt` subcommand, handed `-p hi` |
| `glrs -p wt list` | one headless turn on the prompt `wt list` |
| `glrs wt doctor` | the `wt` subcommand, handed `doctor` — glrs's own `doctor` is not reached |
| `glrs hello world` | subcommand `hello` with `["world"]`, or an error naming what does exist |
| `glrs -p what failed` | one headless turn on the prompt `what failed` |

`-v` and `-h` are matched wherever they sit, including after `-p`, so
`glrs -p run it -v` prints the version instead of running a turn. quoting the
prompt keeps them inside it.

a subcommand takes the rest of the line with it, and what precedes it goes
nowhere. `--model`, `--resume` and extension flags written before a subcommand
are dropped rather than applied, because glrs's own parser never runs on that
branch: `glrs --model x/y wt list` lists worktrees on the configured model and
says nothing about the flag.

## everything after `-p` is the prompt

the rest of the line is joined with spaces and taken verbatim; it does not reach
the parser at all. `glrs -p why did --model fail` sends that sentence to the
model — a prompt that mentions a flag is still a prompt, and a bare word after
`-p` is not a subcommand.

one seam remains: the `--model` check in step 5 scans the whole line, prompt
included. `glrs -p the --model flag` is sent as written, but a prompt whose
`--model` ends the line or is followed by another flag fails with the `--model`
error instead of being sent. quote it.

## `--model provider/id`

sets the model for this run, and only for this run. it works by writing
`GLRS_MODEL` before anything reads the model, so it wins the way that variable
does, in the TUI and under `-p` alike.

the value must contain a `/` and must not be another flag. there is no default
provider, so a bare id names nothing:

```text
glrs --model                 → --model needs a value.
glrs --model -p hi           → --model needs a model id, and "-p" is another flag.
glrs --model bare-id         → --model bare-id — --model needs provider/model-id, and
                               "bare-id" names no provider. There is no default provider —
                               see `glrs doctor`.
```

an empty value is the form that still slips through. `--model=` and `--model ""`
are both read as absent, and the session starts on whatever the config or the
environment says.

the sharp edge is `doctor`. `glrs --model x/y doctor` is not an override —
`doctor` accepts only `--json`, so the leading flag is a parse error:

```text
glrs --model anthropic/claude-opus-4-1 doctor
--model anthropic/claude-opus-4-1 — Unknown arguments
```

to ask `doctor` about a different model, set the variable for the command:
`GLRS_MODEL=anthropic/claude-opus-4-1 glrs doctor`. `update` takes no options at
all, so it ignores a preceding `--model` without saying so.

## `--resume [session-id]`

with an id, that session opens, or `Session not found: <id>` if there is no such
file. with no id, the picker opens over the sessions on disk, and an empty store
is `No sessions to resume.` a session prints `Continue with: glrs --resume <id>`
when it exits, which is where the id comes from.

only `--resume` resumes. this once keyed on there being no arguments at all, so
once extensions could add flags, `glrs --anything` opened the picker instead of
starting a session.

## `glrs --help`

the only route that loads extensions to answer. a subcommand an extension added
is discoverable no other way, and help that omitted `glrs wt` would be help that
lies.

```text
glrs — a terminal coding agent

Usage: glrs [options]           start a session
       glrs -p <prompt>         one headless turn
       glrs <command> [args]    run a command

Commands:
  doctor [--json]        report the resolved model, credentials and extensions
  update                 upgrade glrs in place

Options:
  -p, --print <prompt>   run one turn headless and exit; reads piped stdin too
  --model <provider/id>  override the model for this run
  --resume [session-id]  resume a session, or pick one when given no id
  --version              print the version
  --help                 this
```

when an extension has registered a subcommand, an `Added by extensions:` block
sits between Commands and Options — the name and the one line the extension
described it with:

```text
Added by extensions:
  wt                     Create, audit and clean git worktrees
```

## `glrs doctor [--json]`

reports the resolved model, the provider's label, whether its credentials were
found, the extensions that would load, and every config diagnostic. a credential
is named, never read out: what you get is `missing: ANTHROPIC_API_KEY`.

```text
model: anthropic/claude-opus-4-1
provider: Anthropic
missing: ANTHROPIC_API_KEY
extensions: builtins (bundled)
```

extensions are *resolved* here, not loaded: this says what would run without
running any of it. an extension is a program, and a diagnostic that executes
programs is not a diagnostic. `--json` emits the same report as an object with
`model`, `provider`, `missing`, `note`, `extensions` and `diagnostics`; a key
with nothing to say is absent rather than null, so with no model configured
`model`, `provider` and `note` do not appear at all.
[models and providers](./2-models.md) reads the report line by line.

## `glrs update`

runs `bun add -g @glrs-dev/glrs@next` with its output attached to your terminal.
it upgrades the install in place and needs `bun` on `PATH`.

## subcommands

a first bare word glrs does not claim is offered to the extensions. they are
loaded to find out whether it is a subcommand, which is why a bare `glrs`, a
`-p` run and `glrs doctor` never pay for it. an unclaimed word is an error that
lists what does exist, followed by the help text.

a subcommand runs in the `cli` host: no session, no model, no alternate screen,
and `g.print` straight to stdout so `glrs wt list` pipes into the next command.
a subcommand that throws sends its message to stderr and exits non-zero. which
members of the API answer there and which refuse is in
[extensions](./8-extensions.md).

## extension flags

an extension registers `--name` with `g.flag`, and glrs lifts any long flag it
does not know out of the arguments before parsing. what is lifted is lowercased,
so `--Foo` looks for a flag registered as `foo` — it used to match nothing and
disappear without a word. registration is not lowercased in turn: `g.flag`
stores the name as written, minus a leading `--`, so a name registered with a
capital in it can never be matched.

| written | value delivered |
| --- | --- |
| `--foo=x` | `"x"` |
| `--foo bar` | `"bar"` |
| `--foo --bar` | `""` for `foo`, `""` for `bar` |

flags are dispatched once the extensions have loaded, in the order they appear.
a flag nobody claimed is a transcript notice, `(unknown flag: --name)`, not a
failure — the extension that would have claimed it may be one you turned off. a
handler that throws is reported by name: `(extension) --name failed: <message>`.

extension flags reach the interactive session only. the print branch parses what
precedes `-p` and discards them, since everything after `-p` is prompt.

## print mode

`-p` is the composable half of glrs: one turn, no TUI, no session file.

piped input joins the prompt rather than replacing it, fenced as
`<input>…</input>` so a diff or a log reads as material rather than as further
instructions. both of these work:

```sh
cat build.log | glrs -p "what failed?"
cat build.log | glrs -p
```

with no prompt and nothing piped, the run ends before it starts:
`Nothing to run: -p needs a prompt or piped input.`

assistant text goes to stdout and everything else to stderr — the tool trail,
retries, extension and skill notes, config diagnostics. a redirect keeps the
answer clean and `2>&1` puts the trail back in order around it. that split is
what lets one glrs spawn another through `bash` with every step of the child
visible in the parent's output.

exit status is `0` when the turn completes. it is `1` when the turn throws, when
SIGINT interrupts it (`[interrupted]` on stderr), and when the turn hits the
100-step limit with no answer to show for it, which prints
`[stopped at the step limit without finishing]`.

each run gets a fresh session id, `print-<8 hex>`. hashed together with the
project root, it becomes the `promptCacheKey` sent to OpenAI-shaped providers,
and a constant one would tell the backend that unrelated runs are the same
conversation — after which it looks for reasoning items the previous run left
behind and fails the turn with `Item with id 'rs_…' not found`. nothing is
written to the session store, so a `-p` run cannot be resumed.

extensions load here too — a tool the agent writes for itself has to exist when
it verifies with `-p`, or self-extension is a claim nothing can check. what has
no meaning in a one-shot run refuses out loud: `send()`, `setInput()`,
`reload()` and `setExtension()` say so on stderr and continue; `models()`,
`setModel()` and `ui.capture()` throw. there is no terminal to measure, so
`g.columns()` returns `COLUMNS` read as a number when it is set, and `100`
otherwise.

what the config files behind all of this hold, and what they do when a key is
wrong, is [configuration](./6-configuration.md).
