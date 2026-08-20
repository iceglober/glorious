---
title: configuration
---

# configuration

three JSON files, read nearest first and merged into one. a missing file is not
a problem; a file that parses is read for the keys glrs knows and ignored for
the rest.

| scope | path |
| --- | --- |
| Project-User | `<project>/.glrs/config.local.json` |
| Project | `<project>/.glrs/config.json` |
| User | `<User>/config.json` |

Project-User is yours and gitignored, Project travels with the repository, User
applies everywhere. merging is per key, so Project can pin a model while User
supplies provider settings it never mentions.

## the User directory

`<User>` is resolved once and holds every user-scoped glrs resource, config,
`extensions/`, `commands/`, `skills/`:

1. `GLRS_CONFIG_HOME`, resolved to an absolute path
2. `$XDG_CONFIG_HOME/glrs`
3. on Windows, `%APPDATA%\glrs`, or `<home>\AppData\Roaming\glrs` when
   `APPDATA` is unset
4. `<home>/.config/glrs`

`APPDATA` is Windows's roaming configuration directory. `LOCALAPPDATA` is
deliberately not used: a model choice that does not follow the account between
machines is a setting you make twice.

## what the first run creates

starting a session, `glrs -p` and `glrs doctor` each make sure the files exist
before reading them; `glrs update`, `--version`, `--help` and extension
subcommands do not. an absent file is created holding one key,
`"$schema": "https://glrs.dev/config.schema.json"`. a file that exists without
one has it inserted in place, every other key, and the formatting around it,
survives. the schema is metadata for editors; glrs reads nothing from it.

inside a git repository all three files are created, along with
`<project>/.glrs/.gitignore` holding `/config.local.json`. outside one, only the
User scope is touched. a `.glrs/config.json` in a directory that is not a
repository is still read, it is only never written.

## how three files become one

**scalars take the nearest value.** `model`, `variant`, `toolTimeoutMs`,
`steeringMode` and `followUpMode` are answered by Project-User if it has one,
then Project, then User.

**`extensions.load`, `extensions.disable` and `tools.disable` are unioned across
all three scopes.** they are sets rather than values: a repository you cloned
cannot switch off the extension your User config turns on everywhere, and a name
in any `disable` list stays disabled. turning something off is the direction
that has to be safe.

**`agentConfigAllowlist` is nearest-wins, deliberately not unioned.** permission
to write your config is not something a cloned repository gets to widen.

**`providers` is merged as JSON Merge Patch.** objects merge key by key at every
depth, arrays and scalars replace, and `null` deletes, so one file can drop a
single header another sets, without restating the block.

## keys

| key | type | default | effect |
| --- | --- | --- | --- |
| `model` | `"provider/model-id"` | none | the model. bare ids are rejected; there is no default provider |
| `variant` | string | none | reasoning effort. only `minimal`, `low`, `medium` and `high` are recognised |
| `toolTimeoutMs` | positive number | `600000` | kill deadline for the built-in shell and search tools |
| `steeringMode` | `"one-at-a-time"` or `"all"` | `"one-at-a-time"` | how much of the Alt+Enter queue one delivery takes |
| `followUpMode` | `"one-at-a-time"` or `"all"` | `"one-at-a-time"` | the same, for the Enter queue |
| `extensions.load` | string[] | `[]` | extension names, or paths, to load |
| `extensions.disable` | string[] | `[]` | names that never load, whatever else says |
| `tools.disable` | string[] | `[]` | tool names withheld from the model, whichever extension registered them |
| `agentConfigAllowlist` | string[] | `[]` | config sections glrs may write. only `"extensions"` is understood |
| `providers` | object | `{}` | per-provider connection and call settings, below |

the two queue modes are the same setting for two queues, and
[the session](./3-session.md) has what each one feels like to type against.
`variant` is translated per provider rather than passed through;
[models and providers](./2-models.md) has what `high` becomes on each. a word
outside the four is ignored in silence.

## providers

```json
{
  "providers": {
    "openai": {
      "requestOptions": { "temperature": 0.2 },
      "providerOptions": { "openai": { "textVerbosity": "medium" } },
      "models": {
        "gpt-5": {
          "requestOptions": { "maxOutputTokens": 32000 },
          "metadata": { "context": 400000 }
        }
      }
    },
    "ollama": { "api": "http://localhost:11434/v1" },
    "amazon-bedrock": { "region": "us-east-1" },
    "google-vertex": { "project": "my-project", "location": "us-central1" }
  }
}
```

- `api`, base URL, accepted for every provider.
- `region`, Bedrock only. `project` and `location`, Vertex only. set anywhere
  else, each is dropped with a diagnostic naming it.
- `factoryOptions`, handed to the installed AI SDK provider factory;
  `factoryOptions.apiKey` beats the environment. `fetch` is removed and
  reported: glrs's own carries the request deadlines and the provider lifecycle
  hooks, so it is the one factory option config cannot replace.
- `requestOptions`, AI SDK call settings for every call. the forty-five keys
  that name the agent's own job, `model`, `messages`, `tools`,
  `providerOptions`, `abortSignal`, every `on*` callback, are removed and
  reported one at a time.
- `providerOptions`, namespaced AI SDK options, merged *over* what glrs
  computed for the turn.
- `models.<exact-model-id>`, `requestOptions` and `providerOptions` merged over
  the provider's, plus `metadata` carrying `name`, `context`, `inputCost`,
  `outputCost` and `variants`. metadata you configure wins over the models.dev
  catalogue, which is how a model the catalogue has never heard of still reports
  a context percentage. `factoryOptions` is provider-level only; there is no
  per-model form of it, and one written here is read by nothing.

inside these blocks a key glrs does not recognise is passed through untouched,
so a new AI SDK option does not wait on a glrs release. which seam a given
setting belongs in, and what each provider reads from it, is
[models and providers](./2-models.md)'s subject.

## shorthands and paths

`"extensions": ["web-fetch"]` is read as `extensions.load`, and
`"tools": ["bash"]` as `tools.disable`.

in `extensions.load`, only `~/`, `./` and `../` are treated as paths, and they
resolve against **the config file that declared them**, `./tools/reviewer.ts`
in `<project>/.glrs/config.json` means `<project>/.glrs/tools/reviewer.ts`. it
happens while that file is still known, since a line later the three scopes are
one object. anything else is a name, and fails as one:

```text
extensions.load "tools/reviewer.ts": no extension by that name is bundled or on disk. glrs ships ask-user, builtins, worktree, web-fetch
extensions.load "npm:cool-ext": "npm:" packages need an installer glrs does not have yet. name a bundled extension or a path
```

## letting glrs record one answer

`$schema` aside, no setting in these files is written by glrs. they are
hand-edited, with one opt-in exception:

```json
{ "agentConfigAllowlist": ["extensions"] }
```

with that set, glrs may record whether a first-party extension should load,
without somewhere to keep the answer, declining lasts until the next turn and
you are asked the same question every session. the write lands in Project
`.glrs/config.json`, never the `.local.` file, because which extensions a
project needs belongs with the project. other keys are read and written back
untouched; hand-formatting is not, since the file is re-serialised.

`"extensions"` is the only section understood, and the two routes that reach it
are `/extensions enable` in the composer and the `configure_extension` tool,
[extensions](./8-extensions.md) has both. restart after changing anything else;
`/reload` re-reads the extension and tool blocks.

## environment

| variable | effect |
| --- | --- |
| `GLRS_MODEL` | model, ahead of every config file |
| `GLRS_VARIANT` | reasoning effort, ahead of every config file |
| `GLRS_TOOL_TIMEOUT_MS` | tool timeout, when finite and above zero |
| `GLRS_PRICE_MULTIPLIERS` | `provider=1.5,other=0.5`, scaling catalogue prices |
| `GLRS_CONFIG_HOME` | the User directory |
| `GLRS_DIR` | worktree base directory; default `~/.glrs/worktrees` |
| `XDG_CONFIG_HOME` | User directory base |
| `XDG_DATA_HOME` | sessions at `<base>/glrs/sessions`; default `~/.local/share` |
| `XDG_CACHE_HOME` | models.dev cache at `<base>/glrs/models.dev.json`; default `~/.cache` |
| `APPDATA` | User directory base on Windows |
| `COLUMNS` | terminal width in print mode only; default 100 |
| `NO_COLOR`, `TERM=dumb` | no colour |
| `AWS_REGION`, `AWS_DEFAULT_REGION` | Bedrock region when config gives none; then `us-east-1` |
| `GOOGLE_CLOUD_PROJECT`, `GOOGLE_VERTEX_PROJECT` | Vertex project when config gives none |
| `GOOGLE_CLOUD_LOCATION`, `GOOGLE_VERTEX_LOCATION` | Vertex location when config gives none; then `global` |

credential variables are per provider and listed in
[models and providers](./2-models.md).

`GLRS_MODEL`, `GLRS_VARIANT`, `GLRS_TOOL_TIMEOUT_MS`, `GLRS_PRICE_MULTIPLIERS`
and `GLRS_DIR` each answer to a `GLORIOUS_` spelling as well, read second: the
rename kept every old variable working rather than making a shell-profile edit
the price of upgrading. `GLRS_CONFIG_HOME` is read directly and has no legacy
name.

`--model provider/model-id` sets `GLRS_MODEL` for the run, so it wins the way
the variable does, in both the TUI and `-p`.

## when a setting does nothing

diagnostics are not a `doctor` feature. the TUI prints them as `(config) …` at
startup and after `/reload`, `-p` writes them to stderr as `[config] …`, and
`doctor` lists them under its extension line. every line opens with the file it
came from, written in full, with `$HOME` shortened to `~`.

```text
~/.config/glrs/config.json: not valid JSON, ignored
~/work/app/.glrs/config.json: "model" should be a string like "azure/gpt-5.6-sol", got object, ignored
~/work/app/.glrs/config.json: "steeringMode" should be "one-at-a-time" or "all", got string, ignored
~/work/app/.glrs/config.json: "extensions" has no "load" or "disable" (enable), ignored
~/work/app/.glrs/config.json: extensions.load[2] should be a string, ignored
~/work/app/.glrs/config.json: providers.openai.region is not used by openai, ignored
~/work/app/.glrs/config.json: providers.openai.factoryOptions.fetch is owned by glrs, ignored
```

`{"model": {"selected": "azure/gpt-5.6-sol"}}` is why they exist: it ran for a
week as the default model, because the key was recognised and the value was the
wrong type, so it was dropped exactly as silently as a typo. anything glrs knows
the name of and cannot use now says so, per key and per list entry.

a key it has never heard of, sitting beside one it knows, stays ignored and
silent, a config carrying a setting from a newer or older glrs is not a broken
config. a file where it recognises nothing at all is a different case:

```text
~/work/app/.glrs/config.json: nothing here is a glrs setting (mcpServers, theme, permissions, hooks, …), the whole file is ignored
```

that is almost always a file written for something else. you meet it on a config
glrs has not written to, a project file outside a git repository, because
everywhere else the `$schema` line it inserts is itself a key it knows. a file
whose top level is not an object at all is refused the same way, as
`expected a JSON object, ignored`.

none of this is the only way to change what glrs does. a markdown file, a
`SKILL.md` and an `AGENTS.md` each change it without a config key:
[commands, skills and rules](./7-commands.md).
