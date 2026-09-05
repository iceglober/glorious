tutorials/quick-start.md

# quick start

## install

```bash
curl -fsSL https://glrs.dev/install.sh | bash
```

the script requires git and offers to install Bun when it is missing. for
package managers, PATH fixes and uninstalling: [install](how-to/install-and-update.md).

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
[configuration](reference/configuration.md).

next: [your first extension](tutorials/your-first-extension.md)

see also: [turns](reference/turns.md), [keys](reference/keys.md)


tutorials/your-first-extension.md

# your first extension

you will write a `branches` tool, load it, and watch the model call it.

## set up a scratch repo

```bash
mkdir /tmp/glrs-ext && cd /tmp/glrs-ext && git init
printf 'hello\n' > greeting.txt
git add -A && git commit -m start
git branch fix-login
git branch add-tests
```

## write the extension

```bash
mkdir -p .glrs/extensions
```

put this in `.glrs/extensions/branches.ts`:

```typescript
import type { Extension } from "@glrs-dev/glrs/extension-api";

const extension: Extension = (g) => {
  g.tool({
    name: "branches",
    description: "List this repository's branches, newest commit first.",
    input: g.z.object({}),
    execute: async () => {
      const shell = await g.exec(
        "git for-each-ref --sort=-committerdate refs/heads --format='%(refname:short) %(committerdate:relative)'",
      );
      return shell.output || "no branches";
    },
  });
};

export default extension;
```

three things: a default export taking `g`, a zod schema from `g.z` so the
extension needs no imports of its own, and `g.exec` for the shell.

## use it

`.glrs/extensions` is read at startup, so a new run picks it up.

```bash
glrs --model anthropic/claude-opus-5 -p "which branch was touched most recently?"
```

the model has no git tool, sees `branches` in its tool list, and calls it:

```text
add-tests, committed 2 minutes ago.
```

`-p` loads extensions exactly as a session does, which makes it the fastest way
to check one works.

next: [have glrs write the extension](tutorials/have-glrs-write-the-extension.md), [extensions](reference/extensions.md), [events](reference/events.md)


tutorials/have-glrs-write-the-extension.md

# have glrs write the extension

glrs is given its own documentation and told to write an extension when asked
for something it cannot do. you will ask for a capability it lacks and watch it
build one.

## set up a scratch repo

```bash
mkdir /tmp/glrs-authored && cd /tmp/glrs-authored && git init
printf 'hello\n' > greeting.txt
git add -A && git commit -m start
```

## ask for something it cannot do

```bash
glrs --model anthropic/claude-opus-5
```

type this:

```text
add a /branches command that lists this repo's branches with their last commit date
```

there is no `/branches` command and no tool that lists branches.

## watch what it reads

it reads its own documentation before writing anything:

```text
read   9-reference/11-extensions.md   142 lines
read   1-tutorials/2-first-extension.md   70 lines
write  .glrs/extensions/branches.ts
```

those paths are under glrs's install directory, not your project.

## check the file

```bash
cat .glrs/extensions/branches.ts
```

a `g.command()` call, a `g.exec()` for the git work, and a default export.

## use it

```text
/reload
/branches
```

`/reload` re-reads extensions without restarting.

## why this works

the system prompt lists the reference pages by path and tells the model to read them
when asked about glrs itself. it is pointed at documentation rather than at
`packages/`, so what it can read about glrs is what it can rely on.

next: [design](explanation/design.md), [extensions](reference/extensions.md)


how-to/install-and-update.md

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

next: [quick start](tutorials/quick-start.md), [connect a provider](how-to/connect-a-provider.md), [cli](reference/cli.md)


how-to/connect-a-provider.md

# connect a provider

each provider reads its credential from the environment. the full list of
providers, their aliases and the variables each one reads:
[models](reference/models.md).

## api key

```bash
export ANTHROPIC_API_KEY=sk-…
GLRS_MODEL=anthropic/claude-opus-5 glrs doctor
```

with the key exported and no model set anywhere, `glrs` still starts: the picker
opens and every Anthropic model is at the top of the list.

## azure

`AZURE_FOUNDRY_API_KEY`, `AZURE_API_KEY`, or `AZURE_OPENAI_API_KEY`; the first one set wins.
`AZURE_RESOURCE_NAME` is also required.

## bedrock and vertex

Bedrock reads the standard AWS credential chain: `AWS_ACCESS_KEY_ID`, `AWS_PROFILE`, or
`AWS_BEARER_TOKEN_BEDROCK`, so an SSO profile or an assumed role works. Vertex reads
`GOOGLE_APPLICATION_CREDENTIALS`; `gcloud auth application-default login` is usually enough.

Bedrock reads `AWS_REGION` or `AWS_DEFAULT_REGION`; region falls back to `us-east-1`. Vertex reads
`GOOGLE_CLOUD_PROJECT` or `GOOGLE_VERTEX_PROJECT`, and `GOOGLE_CLOUD_LOCATION` or
`GOOGLE_VERTEX_LOCATION`; location defaults to `global`. config wins:

```json
{
  "providers": {
    "amazon-bedrock": {
      "region": "us-west-2"
    },
    "google-vertex": {
      "project": "acme-dev",
      "location": "us-central1"
    }
  }
}
```

## a local server, or anything unlisted

if the provider prefix in the model string is unknown, it is treated as an
OpenAI-compatible endpoint. it needs a base URL, and nothing else: Ollama,
LM Studio (`http://localhost:1234/v1`), vLLM, or a gateway.

```json
{
  "model": "ollama/qwen3-coder",
  "providers": {
    "ollama": {
      "api": "http://localhost:11434/v1"
    }
  }
}
```

## check it

```bash
glrs doctor
```

a connected provider reports `credentials: found`. anything else prints
`missing:` and the variable it wants.

`/model` reports the same thing per model, listing the ones glrs has credentials
for first and marking the rest `needs OPENROUTER_API_KEY`. it does not stop you
choosing one it cannot see a credential for: Bedrock through an SSO profile and
Vertex through application default credentials both look unconfigured here and
both work, so the turn is sent and the provider decides:
[models](reference/models.md).

see also: [models](reference/models.md), [configuration](reference/configuration.md)


how-to/resume-and-fork.md

# resume and fork

## resume

```bash
glrs --resume            # pick from a list
glrs --resume 3f9a1c2b   # open that session
```

the picker lists every session newest first, titled by your last message, with its id and directory. `enter` opens, `esc` cancels.

## fork

```bash
/session     # read the event count
/fork 42     # copy the first 42 events to a new id
/fork        # copy all of them
```

events include tool calls and results, not just messages. `/fork` prints the new id and leaves you where you are; open the branch with `glrs --resume <id>`.

## inspect

`/session` prints the current id, context, tokens, cost, event count and file path.

sessions are JSON under `$XDG_DATA_HOME/glrs/sessions`, else `~/.local/share/glrs/sessions`. see [configuration](reference/configuration.md).

see also: [turns](reference/turns.md), [cli](reference/cli.md)


how-to/write-a-command.md

# write a command

a markdown file becomes a slash command. glrs has three kinds: native ones that
ship, markdown ones you write, and skills, which answer to `/skill:name`. see
[commands](reference/commands.md).

## write it

`.glrs/commands/review.md`:

```markdown
---
description: review the working diff
---

review the working diff for anything that would fail CI. pay attention to $ARGUMENTS.
```

## run it

```bash
/review the migration
```

the filename is the name, lowercased. frontmatter is optional: without it the
whole file is the prompt.

## arguments

`$ARGUMENTS` is everything after the name. `$1` to `$9` are its words. a body
with no placeholder gets the arguments appended in an `<arguments>` block.

## make it available everywhere

put the file in `<user config>/commands/` instead of the project. on a name
clash the project wins. [configuration](reference/configuration.md)
resolves `<user config>`.

`/reload` picks up a new file without restarting.

next: [write a skill](how-to/write-a-skill.md)


how-to/write-a-skill.md

# write a skill

a skill is instructions the model loads when it decides they apply. a
[command](how-to/write-a-command.md) is one you invoke yourself.

## write it

`.glrs/skills/graphify/SKILL.md`:

```markdown
---
name: graphify
description: build a knowledge graph from notes. use when the user asks to map, link or graph a document.
---

1. read every file named in the request.
2. emit nodes, then edges.
```

## the description is the trigger

the model sees the name and description, not the body. write the description as
*when to use this*, not as what it is.

`name` and `description` are required. without either the skill does not load
and says so at startup.

## invoke it yourself

every skill answers to a skill command:

```bash
/skill:graphify
```

`trigger: graph` makes that `/skill:graph`.

## limit what it can reach

```markdown
allowed-tools: read, grep, glob
```

the model activating the skill is held to that list for the rest of the turn.
typing the slash command sends the body with nothing narrowed.
[tools](reference/tools.md).

## the specification

glrs implements the [Agent Skills specification](https://agentskills.io/specification).
worth reading before writing more than one:
[best practices](https://agentskills.io/skill-creation/best-practices) and
[optimizing descriptions](https://agentskills.io/skill-creation/optimizing-descriptions).

two fields glrs reads are not in the specification:

| field | what it does |
| --- | --- |
| `disable-model-invocation` | hides the skill from the model, leaving only the skill command. popularised by Claude Code and widely recognised |
| `trigger` | renames the skill command |

## where they are found

four roots, project before user, first to claim a name wins:
[skills](reference/skills.md).

next: [set project rules](how-to/set-project-rules.md)


how-to/set-project-rules.md

# set project rules

rules ride in the system prompt on every turn. unlike a
[command](how-to/write-a-command.md) or a [skill](how-to/write-a-skill.md), nothing
invokes them.

## write them

`AGENTS.md` at the project root:

```markdown
- run `bun check` before calling a change done.
- match the file you are editing: naming, layout, error handling.
```

## where they are read from

every directory from your home directory down to the working directory, nearest
last. `~/.config/glrs/AGENTS.md` applies to every project.

`AGENT.md` and `CLAUDE.md` are read when `AGENTS.md` is absent, so a repository
written for another agent works unchanged.

## when they are read

`AGENTS.md` files from your home directory down to the project root are read once,
at startup. restart to pick up an edit; `/reload` does not re-read them.

a file's own directory is searched again every time a tool reads that file, so a
rule beside the code it governs takes effect immediately and applies only when
that code is opened. both paths: [rules](reference/rules.md).

next: [manage extensions](how-to/manage-extensions.md)

see also: [rules](reference/rules.md)


how-to/manage-extensions.md

# manage extensions

## what is loaded

```bash
/extensions
```

all six first-party extensions load, plus anything in `.glrs/extensions/`:
`builtins`, `model-picker`, `tiers`, `ask-user`, `web-fetch`, `worktree`.

## reload after an edit

`/reload` re-reads extensions, skills and commands from disk. they live in `<project root>/.glrs/extensions/` and `<user config>/extensions/`, as `name.ts` or `name/index.ts`.

## replace a bundled one

disk wins over bundled, project before user. `.glrs/extensions/web-fetch.ts` loads instead of the shipped one. a `builtins.ts` of your own drops every tool and slash command with it, and a `model-picker.ts` of your own is what `/model` then runs.

## let glrs record the choice

```json
{
  "agentConfigAllowlist": [
    "extensions"
  ]
}
```

without it `/extensions disable` prints the config line for you to add by hand, and changes nothing. `"model"` is the other section it understands, for what `/model` chose: [configuration](reference/configuration.md).

see also: [extensions](reference/extensions.md), [your first extension](tutorials/your-first-extension.md)


how-to/turn-things-off.md

# turn things off

## every turn

`.glrs/config.json`:

```json
{
  "tools": {
    "disable": [
      "bash",
      "web_fetch"
    ]
  },
  "extensions": {
    "disable": [
      "web-fetch"
    ]
  },
  "toolTimeoutMs": 120000
}
```

- `tools.disable` withholds a tool from the model, whichever extension registered it.
- `extensions.disable` takes that extension's commands with it. disable `builtins` and nothing is left, no tools and no slash commands.
- `toolTimeoutMs` is milliseconds, default 600000. it is the deadline any tool runs under. `GLRS_TOOL_TIMEOUT_MS` wins over it.
- disable lists union across the three config scopes. off in one file is off in all.

`/extensions disable web-fetch` writes that line for you, when `agentConfigAllowlist` includes `extensions`. `/reload` applies both lists. a markdown command stops loading when its file leaves `.glrs/commands/`.

## one turn

```markdown
---
allowed-tools: read, grep, glob
---
```

in a skill's frontmatter: the turn that activates the skill gets those tools and no others. disabling is not a security boundary, see [design](explanation/design.md).

see also: [configuration](reference/configuration.md), [tools](reference/tools.md)


how-to/run-in-a-pipeline.md

# run in a pipeline

`-p` runs one turn and exits: no TUI, no session file. everything after `-p` is the prompt, verbatim, so flags go before it.

```bash
glrs -p "count the TODOs in src/"
cat build.log | glrs -p "summarise the failures"
```

piped input joins the prompt, fenced as `<input>`.

## output

the answer goes to stdout. tool trail, retries, `[config]` diagnostics and
`[provider]` warnings go to stderr.

```bash
glrs -p "count the TODOs" > answer.txt        # answer alone
glrs -p "count the TODOs" 2>&1 | tee run.log  # answer with the trail
```

## exit code

`0` finished. `1` failed, was interrupted, or hit the step limit.

see also: [cli](reference/cli.md)


explanation/design.md

# design

glrs is a model, a turn loop, and a set of extensions over a git repository.

## small core

the core registers no commands and one tool. it discovers, it loads, it runs a
turn. everything the model can reach arrives through a public seam:

| seam | registers |
| --- | --- |
| `g.tool` | something the model can call |
| `g.command` | a slash command |
| `g.cli` | a subcommand on the `glrs` binary |
| `g.on` | a handler for a lifecycle event |
| `g.status`, `g.footer`, `g.activity` | parts of the screen |

`/help` and `bash` are registered through `g.command` and `g.tool`, the same
members any extension uses. neither has a private path into the core.

one tool is core: `activate_skill`. skills are a core concept, discovered and
catalogued by the core and injected into every prompt, and that tool is the
subsystem's own accessor rather than a capability. the tenet is that no
capability is built in.

## builtins

even the primitive tools are an extension. `bash`, `read`, `write`, `edit`,
`grep` and `glob` come from `builtins`, which also registers every slash
command. disable it and the model has nothing to work with, which is the point:
the core does not quietly keep a copy.

## first-party extensions

| extension | provides |
| --- | --- |
| `builtins` | the file, search and shell tools, and every slash command |
| `model-picker` | `/model`, and the picker that opens when no model is set |
| `tiers` | `/tier`, and a default model chosen from what you have credentials for |
| `ask-user` | the `ask_user` tool and its widget, built on `g.ui.capture` |
| `web-fetch` | the `web_fetch` tool |
| `worktree` | the `glrs wt` subcommand and `/wt` |

all six load. asking you to turn one on puts a decision in front of you that you
had no way to evaluate. disable what you do not want, or shadow it with a file
of the same name: disk wins over first-party.

## choosing the model is not core either

the core carries a model or a null, and refuses a turn without one. it ships no
way to pick one, exactly as it ships no way to read a file. `model-picker` reads
the catalogue through `g.models()`, chooses through `g.setModel()`, and writes
the choice through `g.rememberModel()`. every one of those is a public member an
extension you write can call.

that is why the TUI now opens without a model. `/model` is a slash command, and
slash commands exist only inside a session, so refusing to open a session until
a model was set meant the only ways in were `--model` and `GLRS_MODEL`. what the
core owes is the state, not a picker: the status row says `no model`, a turn is
refused rather than sent, and `ModelInfo.missing` reports what each provider
wants so whatever fills the gap can say so ([models](reference/models.md)).

## permissions

glrs has whatever permissions its calling context has. any file you can edit,
any command you can run. no sandbox, and nothing asks before it acts.

there is no gate to configure, and no seam pretending to be one. an extension
can refuse a call from the `tool_call` hook, but it runs in the same process as
the thing it is refusing, so it is a convenience rather than a boundary.

real boundaries come from outside the process:

- **containers** or micro-VMs, for work you do not want touching the host
- **virtual machines**, when the blast radius should include the kernel
- **git worktrees**, so a bad turn is one `git worktree remove` away
- **review before merge**, which is the boundary you already have

file tools resolve relative paths against the project root and take absolute
ones as given. nothing is refused. `bash` is unconfined, so a path check on the file tools
would stop nothing and cost a step.

see also: [a turn](explanation/a-turn.md), [extensions](reference/extensions.md), [tools](reference/tools.md)


explanation/a-turn.md

# a turn

a turn is one exchange: your message, the model's work, its answer. a
step is one model call inside it. a turn with three tool calls takes several
steps.

send the conversation, read the stream, run the tools the model called, send
again. the turn ends when the model calls no tool and has nothing left to say.
a hundred steps is the ceiling.

## what is sent

| part | contents | changes |
| --- | --- | --- |
| **instructions** | the system prompt | never, byte for byte |
| **history** | every earlier message | only by appending |
| **new message** | environment, skills catalogue, extension lines, what you typed | every turn |

nothing volatile is in the system prompt. the date, the git branch and the
skills catalogue ride in the per-turn message instead. a system prompt that
varied would move the cached prefix, and every turn would pay full price for the
whole conversation.

## caching

a provider charges less for a prefix it has seen. that is why history is only
ever appended to, and why steering joins at a step boundary rather than being
inserted earlier.

OpenAI and Google cache a prefix without being asked. Anthropic and Bedrock
cache only what is marked, so glrs marks the second-to-last message: the newest
point that will still be there next turn. the mark advances every turn, which
extends the cached prefix rather than replacing it. on the first turn there is
no second-to-last, so the only message is marked, and the second turn opens on
a prefix the provider has already seen.

everything else reaches an OpenAI-compatible endpoint, and caches or does not
according to the model behind it. glrs sends no cache control there, because
there is none to send: `prompt_cache_key` is OpenAI's, and a Foundry deployment
answers `Unrecognized request argument supplied` rather than ignoring it. the
same is true of `textVerbosity`, which is how a request about verbosity came to
fail as though it were about reasoning.

what that leaves is the prefix itself, which is the part glrs controls. measured
over two turns on one Foundry resource:

| model | reused on the second turn |
| --- | --- |
| `azure/gpt-5.6-sol` | 2601 of 2982 |
| `azure-foundry/DeepSeek-V4-Flash` | 3584 of 4100 |
| `azure-foundry/kimi-k2.6` | nothing; that model does not cache |

a cold prefix reports nothing cached on its first outing. that is the cache
being written, not a failure.

## steering and follow-up

| | joins | costs |
| --- | --- | --- |
| **steering** | the running turn, at its next step | the tokens of what was said |
| **follow-up** | its own turn, once the agent runs out of work | a new turn |

steering takes a modifier because it interrupts; a follow-up does not. steering that
arrives too late to join becomes a follow-up, ahead of the ones already waiting.

## when a stream dies

three layers, innermost first:

1. **fetch** retries a connection that failed while the request was going out.
2. **the model client** retries a refused request, five times.
3. **the turn** re-sends the whole stream, three times.

the third exists because the first two cannot see a mid-response drop: fetch
resolved long ago and the body is still being read.

re-sending is safe only while the attempt is unobservable, meaning no text, no
reasoning and no tool call has been produced. once anything has, the failure
surfaces instead of being retried.

## when the context fills

the context cannot grow forever, so past a threshold the older part is replaced
by a summary. the cut lands on a user message, because a tool result separated
from the call it answers is an invalid request.

thresholds and what survives: [sessions](reference/sessions.md).

see also: [turns](reference/turns.md), [events](reference/events.md), [models](reference/models.md)


reference/cli.md

# cli

`glrs` is short for glorious. both names run the same binary, so use whichever
you prefer.

## project root

everything resolves against the project root: file tools, config discovery,
[rules](reference/rules.md). it is `git rev-parse --show-toplevel`, or the directory
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
| `glrs <word>` | a [subcommand](reference/subcommands.md) an extension registered |

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

a first bare word glrs does not claim goes to the extensions: [subcommands](reference/subcommands.md).

## print mode

assistant text goes to stdout. the tool trail, retries, extension notes, `[config]` diagnostics and `[provider]` warnings go to stderr. piped stdin joins the prompt, fenced as `<input>…</input>`. nothing reaches the session store.

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

see also: [models](reference/models.md), [configuration](reference/configuration.md), [run in a pipeline](how-to/run-in-a-pipeline.md)


reference/the-tui.md

# the tui

the TUI (the full-screen terminal interface) is what `glrs` opens with no
arguments.

```text
transcript     everything that has happened, oldest first
progress       running tools, queued messages, a held queue
completion     commands or paths, while you are typing one
activity       thinking 4.1s · 2 queued (Alt+↑ dequeue) · Esc interrupt
composer       where you type
footer         empty unless an extension draws here
status         provider/model-id (variant) · ctx 41.2k(32%)
```

the status row reads `no model` until one is chosen, and the picker opens over
the composer on the first paint: [models](reference/models.md).

| row | drawn | replaceable with |
| --- | --- | --- |
| transcript | always | a tool renderer, `g.markdown` |
| progress | while a tool runs, or a message waits | |
| completion | while a completion is open | `g.autocomplete` adds a source |
| activity | while busy or compacting | `g.activity` |
| composer | always | `g.ui.capture` |
| footer | never, by default | `g.footer` |
| status | always | `g.status` adds segments |

## composer

where you type. one line grows to many; `shift+enter` adds a line without
sending. queued messages are listed above it, and completion opens below.

every binding: [keys](reference/keys.md).

## the activity row

the activity row is drawn only while busy or compacting, and `g.activity()` replaces it. the phase is `sending`, `waiting`, `thinking`, `writing`, or `compacting`. tokens and percentage read `unknown` without catalogue metadata. mouse selection copies through OSC 52 (a terminal escape the emulator turns into a clipboard write).

## session picker
`up` `down` or `k` `j` move, `shift+up` `shift+down` move 5, `enter` opens, `esc` cancels.

see also: [keys](reference/keys.md), [extensions](reference/extensions.md)


reference/keys.md

# keys

every binding in the [TUI](reference/the-tui.md).

| --- | --- |
| `enter` | send; while busy, queue a follow-up; on an empty composer, release a held queue |
| `alt+enter` | steer the running turn at its next step |
| `shift+enter` | newline |
| `alt+up` | take the newest queued message back into the composer |
| `tab` | accept the selected completion |
| `up` `down` | move in the menu, else history from the first or last line, else the cursor |
| `ctrl+p` `ctrl+n` | previous and next prompt in history, always |
| `esc` | close the menu, else interrupt the turn and hold the queue |
| `ctrl+c` | clear the composer; when empty, interrupt; again within 3s, exit |

## terminals that take a key first

| terminal | key | fix |
| --- | --- | --- |
| Windows Terminal | `alt+enter` | claims it for fullscreen. open its settings with `ctrl+,` (**Settings**, then **Open JSON file**) and unbind it |

```json
{
  "actions": [
    {
      "command": "unbound",
      "keys": "alt+enter"
    }
  ]
}
```

restart glrs afterward. a key the terminal consumes never reaches glrs, so
nothing in glrs's own configuration can recover it.

see also: [the tui](reference/the-tui.md), [turns](reference/turns.md)


reference/models.md

# models

## precedence

highest first:

1. `/model`, for the rest of the session
2. `--model provider/model-id`
3. `GLRS_MODEL`, `GLRS_VARIANT`
4. Project-User `.glrs/config.local.json`
5. Project `.glrs/config.json`
6. User `<user config>/config.json`

there is no default. paths and merge rules: [configuration](reference/configuration.md).

## nothing set

the TUI opens anyway, and `/model` picks one:

```
glrs
? Choose model  7243/7243
  search: ▏
› anthropic/claude-opus-5
  anthropic/claude-sonnet-5
```

the picker is the `model-picker` extension, which loads by default. it opens
itself when nothing is set. `esc` cancels, and the status line then reads
`no model`; pressing `enter` on a message answers
`(no model chosen: /model picks one)` and leaves what you typed in the composer.

with `model-picker` disabled the message names the config instead. either way
nothing is sent to a provider until a model exists.

`-p` is the exception. a pipeline has nowhere to ask, so it still exits with
`No model configured.` before anything runs:

```bash
glrs -p "what failed?"     → No model configured. Set GLRS_MODEL="provider/model-id" …
```

## keeping the choice

`/model` writes `model` and `variant` into `<project root>/.glrs/config.json`
when `agentConfigAllowlist` names `model`:

```json
{
  "agentConfigAllowlist": [
    "model"
  ]
}
```

without it the choice lasts the session and `/model` prints the line to paste.
picking the default reasoning effort removes `variant` rather than writing null.
for every project, put `model` in the User config by hand:
[configuration](reference/configuration.md).

## a provider with no credentials

choosing one always succeeds. the row says what is absent, the switch happens,
and the turn is still sent:

```
› openrouter/~anthropic/claude-opus-latest  needs OPENROUTER_API_KEY
```

```
Model switched to openrouter/~anthropic/claude-opus-latest.
openrouter: glrs cannot see OPENROUTER_API_KEY. Turns are still sent, and the
provider decides.
```

glrs reads the environment and config and nothing else, so an empty list is not
a promise that a call will succeed and a full one is not proof it will fail.
Bedrock through an SSO profile, Vertex through application default credentials,
and any provider an extension registers all report a gap and all work. the
provider's own refusal is the authority, so glrs warns and does not block.

## the id

split on the first `/`. the provider half resolves through aliases, the model half is sent verbatim. no slash, a leading slash, or a trailing slash raises `Model must be "provider/model-id", got "X".`

aliases resolve before anything reads the id, so they work in `--model`, `GLRS_MODEL`, and config `model` alike. `doctor` and the status line report the canonical id.

| alias | canonical |
| --- | --- |
| `claude` | `anthropic` |
| `gemini`, `google-ai` | `google` |
| `vertex`, `google-vertex-ai` | `google-vertex` |
| `bedrock`, `aws` | `amazon-bedrock` |
| `azure-openai`, `azure-ai`, `foundry` | `azure` |
| `together`, `together-ai` | `togetherai` |
| `grok` | `xai` |
| `open-router` | `openrouter` |
 an unknown provider is an OpenAI-compatible endpoint and needs `providers.<id>.api`.

## per-provider settings

| provider | config keys | environment fallback |
| --- | --- | --- |
| `amazon-bedrock` | `api`, `region` | `AWS_REGION`, `AWS_DEFAULT_REGION`; region defaults to `us-east-1` |
| `azure` | `api` | `AZURE_RESOURCE_NAME` is required alongside the key |
| `azure-foundry` | `api` | `AZURE_RESOURCE_NAME`; the base URL is derived from it |
| `google-vertex` | `api`, `project`, `location` | `GOOGLE_CLOUD_PROJECT` or `GOOGLE_VERTEX_PROJECT`, `GOOGLE_CLOUD_LOCATION` or `GOOGLE_VERTEX_LOCATION`; location defaults to `global` |
| everything else | `api` | |

config wins. a key a provider does not accept is dropped with a diagnostic. `glrs doctor` names the credential the selected provider wants.

## option objects

| key | where it goes |
| --- | --- |
| `factoryOptions` | the SDK provider factory; `fetch` is stripped, and a `baseURL` here wins over `api` |
| `requestOptions` | every model call; keys glrs owns are stripped with a diagnostic |
| `providerOptions` | merged over what `variant` produces |

`providers.<id>.models.<exact-model-id>` takes `requestOptions` and `providerOptions`; each merges over the provider's. `metadata` is model-level only.

both levels together:

```json
{
  "providers": {
    "openai": {
      "requestOptions": {
        "maxOutputTokens": 8000
      },
      "models": {
        "gpt-5.6": {
          "metadata": {
            "context": 400000
          }
        }
      }
    }
  }
}
```

## variant

reasoning effort. the accepted values are the model's own, published by
models.dev as `reasoning_options` and overridable with
`providers.<id>.models.<id>.metadata.variants`. across the catalogue they vary
widely: `low, medium, high` for many, `low, medium, high, xhigh, max` for some,
`none, high` for others, and no scale at all for most.

a value the model does not publish is dropped rather than sent: a provider that
rejects it fails the turn, and one that ignores it bills for effort nobody
chose. for providers that want a token budget instead of a word, the budget comes
from where the value sits in that model's own scale, so a three-level model and a
five-level model both reach the ceiling at their top.

one namespace is emitted per call.

| namespace | provider | payload |
| --- | --- | --- |
| `anthropic` | `anthropic`; `google-vertex` when the model id contains `claude` | `thinking.budgetTokens` |
| `google` | `google`; other `google-vertex` | `thinkingConfig.thinkingBudget` |
| `bedrock` | `amazon-bedrock` | `reasoningConfig.budgetTokens`, plus `maxReasoningEffort` for `low`, `medium`, `high` |
| `azure` | `azure` | `reasoningEffort`; DeepSeek deployments route through chat |
| `openai` | `openai`, and every other provider | `reasoningEffort` |

## metadata

context window and prices come from the models.dev catalogue (`https://models.dev/api.json`): one request at startup, 10 second timeout.

- cached to `$XDG_CACHE_HOME/glrs/models.dev.json`, else `~/.cache/glrs/models.dev.json`. the cache is read only when the fetch fails.
- configured `metadata` (`name`, `context`, `inputCost`, `outputCost`, `variants`) always wins over the catalogue.
- `GLRS_PRICE_MULTIPLIERS="provider=1.5,other=2"` scales catalogue prices. non-finite or negative is `1`.
- prices are per million tokens. failure is silent: the status line reads `unknown`.

## tiers

a tier is a name for the model you want for a kind of work, and a list of
candidates in preference order. the first one glrs has credentials for wins.

```json
{
  "extensions": {
    "settings": {
      "tiers": {
        "default": "balanced",
        "fast": ["anthropic/claude-haiku-4-5", "openai/gpt-5.6-mini"],
        "balanced": ["anthropic/claude-opus-5", "azure/gpt-5.6-sol"],
        "deep": [{ "model": "anthropic/claude-opus-5", "variant": "high" }]
      }
    }
  }
}
```

```
/tier              list them, and what each resolves to
/tier deep         switch
```

```
  fast                azure/gpt-5.6-luna
› balanced (default)  azure/gpt-5.6-luna
  deep                nothing reachable
```

glrs ships no tiers and no opinion about which model belongs in which. a table
saying `medium = opus-5` is wrong the month a new model lands. the names are
yours, so they need not avoid `low`, `medium` and `high`, which mean reasoning
effort everywhere else ([variant](#variant)).

`default` names the tier used when a session opens with no model. it resolves
before the picker opens, so the ordinary path is that you never see the picker.
`-p` is not covered: it resolves its model before extensions load, so a
pipeline still needs `GLRS_MODEL` or `model` in config.

a lone string is a tier of one. anything that is not `provider/model-id` is
dropped rather than guessed at, and a tier left with nothing usable does not
appear.

## azure, and azure-foundry

one Foundry resource, two surfaces.

| model | provider | why |
| --- | --- | --- |
| an OpenAI deployment: `gpt-5.6-sol` | `azure` | the responses API, prompt caching, `textVerbosity` |
| anything else: `grok`, `kimi`, `deepseek` | `azure-foundry` | the chat API at `/openai/v1`, authenticated with `api-key` |

```bash
GLRS_MODEL=azure-foundry/grok-4.6 glrs -p "hello"
```

no config: the base URL comes from `AZURE_RESOURCE_NAME` and the key from the
same variables `azure` reads. `providers.azure-foundry.api` overrides the URL
for a resource glrs cannot name.

a non-OpenAI deployment under `azure/` fails on options only OpenAI accepts:

```
Unsupported value: 'low' is not supported with the 'grok-4.6-1' model.
```

that is `textVerbosity`, not the reasoning effort the message suggests. set
`providers.azure.models.<id>.modelType` to `chat` to stay under `azure/`, or use
`azure-foundry/` and configure nothing.

## provider warnings

the model answers, but the provider dropped something on the way. reported in
the transcript as `(provider warning)`, on stderr as `[provider]` under `-p`:

```
(provider warning) azure.responses/gpt-5.6-luna: topK is not supported
```

said once per provider, model and first sentence, for the life of the process.
these arrive once per model call, so the second copy is dropped rather than
repeated. the text is clipped to 160 characters: the SDK embeds whatever it is
complaining about, and for `Non-OpenAI reasoning parts are not supported` that
is the whole reasoning block.

glrs does not act on them. a warning is not a failed turn, and a turn that
failed says so on its own.

see also: [connect a provider](how-to/connect-a-provider.md), [configuration](reference/configuration.md)


reference/sessions.md

# sessions

a session is one conversation. it has an id, and it is stored as a log of
events.

## on disk

`$XDG_DATA_HOME/glrs/sessions/<id>.json`, else `~/.local/share/glrs/sessions/`.
prompt history is `prompts.json` beside them.

```json
{
  "schema": 2,
  "id": "3f9a1c2b",
  "createdAt": "",
  "updatedAt": "",
  "cwd": "",
  "events": [],
  "contextTokens": 0
}
```

`.../glorious/sessions/` is read, never written. a session resumed from there is
saved to the new path.

## entries

a session is a log. each record in it is an entry. the extension API calls them
entries too (`g.appendEntry`, `g.entries`).

these are not [lifecycle events](reference/events.md), which are announcements an
extension hooks while glrs runs. entries are what is on disk.


| entry | recorded when |
| --- | --- |
| `user` | you send a message. carries `steer` when it joined a running turn |
| `assistant` | the model answers |
| `tool` | a tool runs. carries its input and result, so an extension can redraw it |
| `reasoning` | the model reasons, kept in full |
| `usage` | a model call reports tokens and cost |
| `turn` | a turn ends, carrying the raw messages |
| `notice`, `error` | glrs says something |
| `cleared`, `compacted` | the replay boundary moves |
| `custom` | an extension's own data. never sent to the model |

the file is written on `usage` and `turn`, at turn end, and at idle. a notice
reaches disk on the next of those.

## resume, switch, fork

| action | effect |
| --- | --- |
| `glrs --resume <id>` | reopen that session |
| `glrs --resume` | pick from a list, newest first |
| `/fork` | copy the whole session to a new id |
| `/fork 42` | copy the session up to entry 42 into a new id |

a fork leaves the original untouched. the copy is on disk immediately, so
`glrs --resume <new-id>` opens it.

## context

the context is what the model is working from: the system prompt, the
conversation so far, and what rode along with this turn. the status line shows
how much of the model's window it fills.

`/clear` drops what the model replays and keeps the transcript on screen.

## compaction

past 75% of the window the older part of the conversation is summarised and
replaced by one message:

```text
<earlier-conversation>
…
</earlier-conversation>
```

a tool result separated from the call it answers is an invalid request, so the
cut walks back to the newest user message that still leaves about 20k tokens of
recent work. everything after it survives verbatim. everything before it is the
brief.

`/compact` forces it early. `/compact <instruction>` steers what the brief
keeps.

see also: [turns](reference/turns.md), [a turn](explanation/a-turn.md), [resume and fork](how-to/resume-and-fork.md)


reference/turns.md

# turns

a turn is one exchange: your message, the model's work, its answer. a step is
one model call inside it.

## queues

| queue | key | delivery | setting |
| --- | --- | --- | --- |
| follow-up | `enter` | its own turn once the current one finishes | `followUpMode` |
| steering | `alt+enter` | joins the running turn at its next step | `steeringMode` |

`one-at-a-time` (the default) delivers the oldest waiting message. `all` delivers everything waiting, joined by a blank line. with nothing running, `alt+enter` is just a turn.

## caching

a provider charges less for a prefix it has seen before, so the prefix is kept
stable: the system prompt is byte-identical every turn, and steering is appended
rather than inserted.

| provider | how |
| --- | --- |
| openai, google | caches a prefix without being asked |
| anthropic | needs a breakpoint written into the messages |
| amazon bedrock | needs a `cachePoint` |

the breakpoint goes on the second-to-last message, the newest point still
present next turn. it advances each turn, which extends the cached prefix rather
than replacing it.

why it is shaped that way: [a turn](explanation/a-turn.md).

see also: [resume and fork](how-to/resume-and-fork.md), [a turn](explanation/a-turn.md)


reference/tools.md

# tools

| tool | action | extension |
| --- | --- | --- |
| `bash` | run a command with `bash -lc` in the project root | `@glrs-dev/glrs-ext-builtins` |
| `read` | read a UTF-8 text file, numbered lines | `@glrs-dev/glrs-ext-builtins` |
| `write` | replace a whole file, creating parent directories | `@glrs-dev/glrs-ext-builtins` |
| `edit` | exact string replacements across one or more files | `@glrs-dev/glrs-ext-builtins` |
| `grep` | search contents with a regex, returns `path:line:text` | `@glrs-dev/glrs-ext-builtins` |
| `glob` | list files matching a glob, newest first | `@glrs-dev/glrs-ext-builtins` |
| `web_fetch` | fetch up to 10 pages as markdown, cached 15 minutes | `@glrs-dev/glrs-ext-web-fetch` |
| `ask_user` | ask questions with selectable answers | `@glrs-dev/glrs-ext-ask-user` |
| `activate_skill` | load a skill's full instructions by name | core |

every tool but `activate_skill` comes from an extension. that one is core
because [skills](reference/skills.md) are core; it registers first, so an extension can
still replace it. `tools.disable` withholds a name. `ask_user` is registered only when a TUI is present, so under `-p` the model
never sees it ([the tui](reference/the-tui.md)).

- `read` prefixes each line with `N|`. display only, not part of the file.
- relative paths resolve against the project root. absolute paths are taken as given.
- nothing is refused. there is no path confinement: [design](explanation/design.md).
- `grep` and `glob` respect `.gitignore` and skip `.git`.
- `includeIgnored` reaches ignored and hidden files.

## limits

| limit | value |
| --- | --- |
| any tool result | 30,000 characters, then `[truncated, N chars omitted]` |
| `bash` stdout, stderr | 20,000 and 9,000 characters, applied first |
| `grep` maxResults | default 100, max 500, then `[truncated at N matches]` |
| `glob` maxResults | default 200, max 1000 |
| command deadline | `toolTimeoutMs`, default 600000 |

past the deadline: SIGTERM to the process group, SIGKILL five seconds later, then `[timed out after 600s]`.

## results

one string. `bash` returns stdout, then stderr, then `[exit N]` when it fails. a thrown error becomes `ERROR: <message>`, which marks the call failed.

`edit` resolves every replacement in every file before writing anything. one bad replacement leaves every file unchanged. each file is renamed into place.

see also: [design](explanation/design.md), [turn things off](how-to/turn-things-off.md)


reference/commands.md

# commands

a command is a prompt you invoke by typing `/name`. three kinds, named by how
they are defined:

| kind | defined as | example |
| --- | --- | --- |
| **native** | code, through `g.command()` | `/help` |
| **markdown** | a `.md` file you write | `/review` |
| skill command | every [skill](reference/skills.md) answers to one | `/skill:graphify` |

native commands ship with glrs or come from any extension. origin is not the
axis; definition is.

## discovery

a command is a prompt you invoke with `/name`. a skill is instructions the model may choose, in any directory holding a `SKILL.md`. roots are read at startup and on `/reload`, four directories deep for skills. one namespace holds every command, filled by extensions, then skills, then markdown files; the first to claim a name wins. the core registers none, `builtins` registers all of the below.

| kind | roots, in order |
| --- | --- |
| commands | `<project root>/.glrs/commands/*.md`, [`<user config>`](reference/configuration.md)`/commands/*.md` |
| skills | `<project root>/.glrs/skills`, `<project root>/.agents/skills`, `<user config>/skills`, `~/.config/agents/skills`, then each loaded extension's `skills/` |

## what ships

| command | effect |
| --- | --- |
| `/help` | commands, keys, and extension flags |
| `/skills` | every skill, its origin, and whether the model is offered it |
| `/extensions [enable\|disable <name>]` | list loaded extensions, or record the choice in config |
| `/clear` | drop the conversation the model replays, keep the transcript |
| `/wt` | the worktree extension: `new`, `list`, `doctor` |
| `/reload` | re-read extensions, skills and commands |
| `/compact [instruction]` | summarise the conversation so far |
| `/fork [n]` | copy the session to a new id, up to entry `n` or whole |
| `/session` | id, context, tokens, cost, events, file |

## command files

```markdown
---
description: open a pull request
---
open a PR for the current branch. $ARGUMENTS
```

frontmatter is optional and `description:` is its only field, the body is the prompt. `$ARGUMENTS` is everything typed after the name, `$1` to `$9` are its words. a body with neither still receives them, appended as `<arguments>…</arguments>`.

see also: [skills](reference/skills.md), [rules](reference/rules.md), [write a command](how-to/write-a-command.md)


reference/skills.md

# skills

a skill is instructions the model loads when it judges them relevant. you
invoke a [command](reference/commands.md); the model activates a skill.

glrs implements the [Agent Skills specification](https://agentskills.io/specification).
two fields below are not in the specification, and are marked.

## frontmatter

| field | effect |
| --- | --- |
| `name` | required. the skill's name |
| `description` | required. what the model reads to decide |
| `trigger` (not in the specification) | renames the command to `/skill:<trigger>` |
| `allowed-tools` | tools the turn is held to, comma or space separated |
| `disable-model-invocation` | `true` withholds it from the model, leaving the command. a convention, not part of the Agent Skills standard |
| `license`, `compatibility`, `metadata` | parsed, offered to extensions by `g.inspect()`, not acted on |

every skill answers to `/skill:<name>` and unknown fields are ignored. `allowed-tools` binds only when the model calls `activate_skill`: the rest of that turn keeps that list plus `activate_skill`, composed with `tools.disable`; typing the command restricts nothing. a skill with no frontmatter, no closing `---`, no `name`, or no `description` does not load, and a duplicate name loads the first only. an over-long or off-standard name, a description over 1024 characters, a `compatibility` over 500, or a directory named differently from the skill each warn and load. warnings print as `(skill) …` in the transcript, `[skill] …` under `-p`.

## where they are found

in order. the first root to claim a name keeps it.

| root | holds |
| --- | --- |
| `<project root>/.glrs/skills` | this project's skills |
| `<project root>/.agents/skills` | this project's, in the shared agent location |
| `<user config>/skills` | yours, for every project |
| `~/.config/agents/skills` | yours, in the shared agent location |
| an extension's `skills/` | shipped with an extension, read last |

a skill is any directory holding a `SKILL.md`, found by a walk four levels deep
that skips `node_modules`, `.git`, `scripts`, `references` and `assets`.

## the skill command

every skill answers to `/skill:<name>`, or `/skill:<trigger>` when `trigger` is
set. typing it sends the body with nothing narrowed; the model activating the
skill through `activate_skill` is held to `allowed-tools` for the rest of the
turn.

see also: [commands](reference/commands.md), [tools](reference/tools.md), [write a skill](how-to/write-a-skill.md)


reference/rules.md

# rules

rules are text that reaches the model without anyone invoking it. they come from
`AGENTS.md`, and from `AGENT.md` or `CLAUDE.md` when that is absent, so a
repository written for another agent works unchanged.

```markdown
- run `bun check` before calling a change done.
- match the file you are editing: naming, layout, error handling.
```

## two kinds, arriving two ways

| kind | read | arrives in |
| --- | --- | --- |
| startup rules | once, when glrs opens | the system prompt |
| a file's own rules | every time a tool reads a file | that read's result |

this distinction matters. the system prompt is byte-identical on every turn, so
that a provider's cache keeps hitting ([a turn](explanation/a-turn.md)).
rules discovered mid-session cannot go there, so they ride back with the file
that brought them, under `AGENTS.md guidance:`.

## startup rules

read once, from every directory between your home directory and the project
root, nearest last:

| location | applies to |
| --- | --- |
| `/etc/glrs/AGENTS.md` | every project on the machine |
| `~/.config/glrs/AGENTS.md` | every project of yours |
| `~/.config/AGENTS.md` | every agent you run, not only glrs |
| each directory down to `<project root>` | that directory and below |

on macOS `/Library/Application Support/glrs/AGENTS.md` is read too; on Windows
`%ProgramData%\glrs\AGENTS.md`.

glrs also reads amp's machine-wide locations (`/etc/ampcode/AGENTS.md` and
`~/.config/amp/AGENTS.md`) for the same reason it reads `CLAUDE.md`: a machine
already set up for another agent works without being set up again.

## a file's own rules

when a tool reads a file, glrs looks for rules in that file's own directory and
its ancestors, and appends what it finds to the result the model sees.

a rule beside the code it governs therefore applies when the model opens that
code, and costs nothing on turns that never touch it.

## when they are re-read

startup rules are read once. `/reload` re-reads commands, skills and extensions,
not rules; restart to pick up an edit. a file's own rules are read on every
`read`, so editing one takes effect immediately.

see also: [commands](reference/commands.md), [set project rules](how-to/set-project-rules.md)


reference/extensions.md

# extensions

an extension is a TypeScript file that default-exports a function taking `g`, the glrs API. Bun imports `.ts` directly, so there is no build step, and `g` needs no imports: `g.z` is zod.

## discovery

| path | source |
| --- | --- |
| `<project root>/.glrs/extensions/` | disk, Project |
| `<user config>/extensions/` | disk, User |
| bundled, when on | bundled |
| absolute paths in `extensions.load` | config |

`name.ts` or `name/index.ts`, walked in that order. the first claim on a name wins. `<user config>` is the directory named under [configuration](reference/configuration.md). one that throws on import or in its function costs only itself and says so at startup; `glrs doctor` resolves the list without running any of it.

## first-party extensions

| name | package | provides |
| --- | --- | --- |
| `builtins` | `@glrs-dev/glrs-ext-builtins` | the six file and shell tools, and every slash command |
| `model-picker` | `@glrs-dev/glrs-ext-model-picker` | `/model`, and the picker that opens when no model is set |
| `tiers` | `@glrs-dev/glrs-ext-tiers` | `/tier`, named tiers of model resolved against your credentials |
| `ask-user` | `@glrs-dev/glrs-ext-ask-user` | `ask_user`, a multiple-choice question answered in the TUI |
| `web-fetch` | `@glrs-dev/glrs-ext-web-fetch` | `web_fetch`, a page as markdown, JavaScript rendered when Chrome is installed |
| `worktree` | `@glrs-dev/glrs-ext-worktree` | git worktrees, and `glrs wt` |

`extensions.load` names one by name or by package, `extensions.disable` wins over it, and a file on disk of the same name replaces it. taking `builtins` leaves the model with no tools unless yours registers them. taking `model-picker` leaves a session that started without a model with no way to choose one in the TUI: [models](reference/models.md).

## api

| area | members |
| --- | --- |
| register | `tool` `command` `cli` `key` `flag` `on` |
| host | `root` `exec` `mode` `hasUI` `settings` `available` `setExtension` `inspect` `reload` `shutdown` `events.emit` `events.on` |
| turn | `send` `abort` `idle` `pending` `usage` `systemPrompt` `prompt` `clear` `compact` `model` `models` `setModel` `rememberModel` `setThinkingLevel` `tools` `filterTools` `session` `setSessionName` `appendEntry` `entries` |
| draw | `print` `columns` `clip` `status` `footer` `activity` `markdown` `ui.capture` `ui.setInput` |

every signature: the generated **Extension API** page, built from `packages/glrs-coding-agent/src/public-extension-api.ts`. every payload: [events](reference/events.md).

`model()` returns null when nothing has been chosen: a session opens before a
model exists. `setModel` switches for the session, `rememberModel` writes the
active one into the project config and returns `"not-allowed"` unless
`agentConfigAllowlist` names `model`. every `ModelInfo`, from `model()` and from
`models()` alike, carries `missing`: the variables or config keys glrs could not
find for that provider, empty when it found them all.

```typescript
const chosen = g.model();
if (chosen === null) g.print("nothing chosen yet");
else if (chosen.missing.length > 0) g.print(`set ${chosen.missing.join(", ")}`);
```

`missing` reads the environment and config and nothing else, so empty is not a
promise a call will succeed: [models](reference/models.md).

a tool filter narrows what the model may call, from the next model call. every filter has to agree, so they can only narrow; `filterTools` returns `{ lift }`, which removes your own and nobody else's. a handler returning `undefined` changes nothing. a tool name already claimed is refused, and `/extensions` lists it as shadowed.

renderers run synchronously during a paint. `footer` returns `Line[]`, `activity` returns `Line[]` or null to keep glrs's own, `status` returns a string or null. a span marked `fill` takes a background, and one on a line pads it out to the terminal width.

```typescript
type Tone = "accent" | "highlight" | "muted" | "prompt" | "success" | "warning" | "danger";
type Span = {
  text: string;
  tone?: Tone;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  fill?: boolean;
};
type Line = Span[];
```

## config

an extension reads its own block and no other:

```json
{
  "extensions": {
    "settings": {
      "tiers": {
        "default": "balanced"
      }
    }
  }
}
```

```ts
const settings = g.config() as { greeting?: string } | undefined;
```

keyed by the extension's name, merged across the three scopes as JSON. glrs
never looks inside, so the shape is yours to define and yours to validate.

## stability

from 1.0.0 every member of the API is covered by semver: a break is a major.

| marking | promise |
| --- | --- |
| unmarked | stable. a break is a major |
| `@beta` | may change in a minor |

the generated **Extension API** page carries the markings. seven members are
`@beta` today: `forkSession`, `entryRenderer`, `history`, `messageRenderer`,
`setLabel`, `switchSession`, `truncateHead`.

a field added to a type you can construct is optional, so a new one is an
addition and not a break. `ModelInfo.missing` is why: it arrived required and
broke the picker that builds its own catalogue rows.

## hosts

`g.mode` is `tui`, `print` or `cli`. `hasUI` is true only in the TUI.

- **everywhere**: `root`, `exec`, `columns`, `settings`, `available`, `tool`, `command`, `cli`, `on`.
- **`-p`**: `ui.capture`, `models` and `setModel` throw. `model()` is never null and `rememberModel` returns `"already"`, a one-shot run taking its model from the environment or the config already on disk. `send`, `ui.setInput`, `reload` and `setExtension` write a notice to stderr and do nothing. `print` goes to stderr. `clear` returns `"empty"`, `compact` returns `"too-short"`. `session`, `setSessionName`, `appendEntry` and `entries` are stubs, a `-p` run having no session file. keys and flags register and never fire.
- **subcommand**: `print` goes to stdout, undecorated. `inspect` is empty. every member needing a session throws, naming itself.

## sdk

`@glrs-dev/glrs` exports `createAgentCore`, `createCodingAgent`, `createProviderRegistry` and `jsonSessionRepository` for embedding a session in another host: the generated **SDK** page, built from `packages/glrs-coding-agent/src/sdk.ts`. an extension imports `@glrs-dev/glrs/extension-api` instead.

see also: [your first extension](tutorials/your-first-extension.md), [events](reference/events.md)


reference/events.md

# events

an event is something glrs announces while it runs. an extension handles one
with `g.on`.

these are not the [entries](reference/sessions.md) written to a session file. events
are announcements; entries are the record.

most handlers only observe. for the events marked below, what the handler
returns changes what happens next; returning nothing leaves it alone.

## handling one

```typescript
export default (g) => {
  g.on("tool_call", ({ name }) => (name === "write" ? "this session is read-only" : undefined));
};
```

1. handlers run in registration order, one at a time, each awaited.
2. a handler that throws is reported and the chain continues: `<event> handler failed: <message>`, prefixed `(extension)` in the TUI, on stderr under `-p`.
3. `false` ends the chain. no later handler runs.
4. otherwise the last handler returning anything but `undefined` wins.
5. an event with an empty cell below ignores what its handlers return.

## events

| event | payload | returning |
| --- | --- | --- |
| `session_start` | `{root}` | |
| `session_end` | `{root}` | |
| `input` | `{text}` | string replaces what was typed, `false` swallows it |
| `user_bash` | `{command}` | |
| `turn_start` | `{text}` | |
| `turn_end` | `{text}` | |
| `idle` | `{}` | |
| `message` | `{kind: "text" \| "reasoning", text}` | |
| `before_request` | `{prompt, messages}` | string appended to this turn's message |
| `tool_call` | `{name, input}` | string or `false` blocks the call |
| `tool_start` | `{name, input}` | |
| `tool_end` | `{name, input, ok, result, detail, elapsedMs}` | string replaces what the model is told the tool returned |
| `model_select` | `{model, variant?}` | |
| `usage` | `{input, output, cached, cost?, contextTokens}` | |
| `reasoning` | `{text, elapsedMs}` | |
| `error` | `{message}` | |
| `compact` | `{dropped, kept, automatic}` | |
| `context` | `{messages, step}` | `ModelMessage[]` replaces what this call sends |
| `before_provider_request` | `{url, headers, body}` | `headers` merge over the request's, `body` replaces it |
| `after_provider_response` | `{url, status, headers}` | |
| `agent_start` | `{ prompt }` | nothing |
| `agent_end` | `{ text }` | nothing |
| `before_agent_start` | `{ prompt, systemPrompt }` | a string replaces the prompt, `false` cancels the turn, an object replaces either field |
| `session_before_compact` | `{ automatic, instruction? }` | `false` cancels it, an object supplies the summary or the instruction |
| `session_before_fork` | `{ id, at? }` | `false` cancels the fork |
| `session_before_switch` | `{ from, to }` | `false` cancels the switch |
| `session_shutdown` | `{ root }` | nothing, awaited before the process exits |

## print mode

`glrs -p` fires every event except `input`, `user_bash`, `model_select` and `compact`.

## sharp edges

- `context` fires once per stream attempt, not once per step. `step` is the attempt number, from 1, and a re-sent stream fires it again.
- `context` replaces what one call sends. the stored conversation is untouched.
- `before_request.messages` is a count of stored messages, not the messages. read them in `context`.
- under `-p`, `before_request.messages` is always `0`.
- a blocked `tool_call` reaches the model as the tool's result: `ERROR: <your string>`, or `ERROR: an extension blocked <name> for this turn.` for `false`. the turn continues.
- the TUI fires `idle` then `turn_end`. `-p` fires `turn_end` then `idle`.
- both hosts await `session_end`, so work on the way out finishes. the TUI's screen stops as soon as it resolves, so printing there lands nowhere.

see also: [extensions](reference/extensions.md), [a turn](explanation/a-turn.md)


reference/subcommands.md

# subcommands

a subcommand runs deterministic work and exits. no session, no model, no
alternate screen.

```bash
glrs wt list
```

## wt new

prints the path, and nothing else:

```bash
cd $(glrs wt new fix the login redirect)
```

a `wt_new` hook that failed writes to stderr, so it is visible when you are
watching and absent from `$(…)`. the worktree still stands.

## how one is found

the first bare word glrs does not claim is offered to the extensions, which load
to answer it. an unclaimed word is `Unknown subcommand 'x'.` plus the help text,
exit 1.

`--help` is the only other route that loads extensions, which is why it can list
what they added.

## what ships

| subcommand | from | does |
| --- | --- | --- |
| `wt` | the `worktree` extension | creates and audits git worktrees |
| `update` | glrs | runs `bun add -g @glrs-dev/glrs@next` |
| `doctor` | glrs | reports what would run, without running it |

## what a subcommand can reach

`g.print` goes to stdout undecorated, so output pipes. `g.root` and `g.exec`
work. every member of the extension API that needs a session throws, naming
itself:

```text
g.model() needs a session, and a glrs subcommand runs outside one.
```

## adding one

```typescript
g.cli("wt", { description: "manage git worktrees", run: (args) => {} });
```

`args` is everything after the subcommand name. glrs does not interpret it.

see also: [extensions](reference/extensions.md), [cli](reference/cli.md)


reference/configuration.md

# configuration

JSON files, hand-edited; unknown keys are ignored. every key is in the schema at `https://glrs.dev/config.schema.json`, which `$schema` points editors at. the `providers` block: [models](reference/models.md).

## files

| scope | path |
| --- | --- |
| Project-User | `<project root>/.glrs/config.local.json` |
| Project | `<project root>/.glrs/config.json` |
| User | `<user config>/config.json` |

a missing file is not an error. the User directory is the first of `$GLRS_CONFIG_HOME`, `$XDG_CONFIG_HOME/glrs`, `%APPDATA%/glrs` on Windows, `~/.config/glrs`. `LOCALAPPDATA` is not used.

in `extensions.load`, `~/` resolves against home and `./` or `../` against the directory of the file that named them. every other entry is a bare name.

```json
{
  "extensions": {
    "load": [
      "web-fetch",
      "./tools/reviewer.ts",
      "~/lab/tap.ts"
    ]
  }
}
```

## first run

in a git repository all three files are created, outside one only the User file. each new file holds `{"$schema": "https://glrs.dev/config.schema.json"}`; an existing file without `$schema` has it inserted in place. `.glrs/.gitignore` is created containing `/config.local.json`.

## extensions.settings

config belonging to individual extensions, keyed by extension name:

```json
{
  "extensions": {
    "settings": {
      "tiers": {
        "default": "balanced",
        "balanced": ["anthropic/claude-opus-5", "azure/gpt-5.6-sol"]
      }
    }
  }
}
```

glrs never reads inside a block. an extension is handed its own and no other,
so two of them cannot argue about what a key means: [extensions](reference/extensions.md).

## merge

| keys | rule |
| --- | --- |
| `model`, `variant`, `toolTimeoutMs`, `steeringMode`, `followUpMode`, `agentConfigAllowlist` | nearest wins: Project-User, then Project, then User |
| `extensions.load`, `extensions.disable`, `tools.disable` | union of the three scopes, and disabled anywhere stays disabled |
| `extensions.settings` | JSON Merge Patch, deep; `null` deletes a key |
| `providers` | JSON Merge Patch, deep; `null` deletes a key |

## agentConfigAllowlist

```json
{
  "agentConfigAllowlist": [
    "extensions",
    "model"
  ]
}
```

two sections are understood; anything else in the list does nothing.

| section | what glrs may then write |
| --- | --- |
| `extensions` | `extensions.load` and `extensions.disable`, recording one as loaded or disabled |
| `model` | `model` and `variant`, recording what `/model` chose |

it writes `<project root>/.glrs/config.json`, never `config.local.json`. the write is a JSON round trip: comments and formatting do not survive. without the entry glrs prints the config line for you to add by hand and changes nothing.

## environment

| variable | effect |
| --- | --- |
| `GLRS_MODEL` | model, over config |
| `GLRS_VARIANT` | variant, over config |
| `GLRS_TOOL_TIMEOUT_MS` | tool timeout, over config; finite and above 0 |
| `GLRS_PRICE_MULTIPLIERS` | `provider=1.5,other=2`, scaling catalogue prices |

each name above has a `GLORIOUS_` fallback, read second. `GLRS_CONFIG_HOME` does not.

## diagnostics

reported in the transcript as `(config)`, on stderr as `[config]` under `-p`, and by `glrs doctor`.

| message | meaning |
| --- | --- |
| `<path>: not valid JSON, ignored` | the file was not parsed |
| `<path>: "model" should be a string like "azure/gpt-5.6", got number, ignored` | wrong type, the key is dropped |
| `<path>: nothing here is a glrs setting (k1, k2, …), the whole file is ignored` | no known key in the file |
| `<path>: providers.X.requestOptions.model is owned by glrs, ignored` | glrs sets that call option itself |

## sessions

where they are stored, and what is in one: [sessions](reference/sessions.md).

see also: [turn things off](how-to/turn-things-off.md), [models](reference/models.md)
