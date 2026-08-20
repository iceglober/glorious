# glrs — component survey at `cc4b0e9`


Organised by component. Each section owns everything about one part of the system — what it does,
which hosts expose it, and what inside it is **not on a live path**. Dead code sits with the
component it belongs to rather than in a separate appendix; the index at the end lists every dead
item in one place for when that is the view you want.

## Component map

| # | Component | Owns |
|---|---|---|
| 1 | [CLI entry and dispatch](#1-cli-entry-and-dispatch) | `bin/glrs`, `index.ts` `main()`, argv, flags, `doctor`, `update` |
| 2 | [Hosts](#2-hosts) | `index.ts` (TUI), `print.ts` (`-p`), `cli.ts` (subcommand) and what each supports |
| 3 | [Configuration](#3-configuration) | `provider-registry/src/config.ts`, `writeconfig.ts` |
| 4 | [Models and providers](#4-models-and-providers) | `provider-registry/src/models.ts`, `providers.ts` |
| 5 | [Sessions and the event log](#5-sessions-and-the-event-log) | `glrs-core/src/session.ts`, `events.ts` |
| 6 | [Shell execution](#6-shell-execution) | `glrs-core/src/shell.ts`, `direct-shell.ts` |
| 7 | [Agent turn loop](#7-agent-turn-loop) | `agent.ts`, `chat.ts`, `queue.ts` |
| 8 | [Prompt and context assembly](#8-prompt-and-context-assembly) | `prompt.ts`, `guidance.ts`, `mentions.ts` |
| 9 | [Skills and commands](#9-skills-and-commands) | `skills.ts`, `commands.ts`, `usercommands.ts` |
| 10 | [Tools and tool plumbing](#10-tools-and-tool-plumbing) | `toolkit.ts`, tool filtering in `agent.ts` |
| 11 | [Extension platform](#11-extension-platform) | `extension-api.ts`, `extensions.ts` |
| 12 | [Bundled extensions](#12-bundled-extensions) | `packages/extensions/{builtins,ask-user,web-fetch,worktree}` |
| 13 | [Terminal UI](#13-terminal-ui) | `render.ts`, `ui/screen.ts`, `ui/chrome.ts`, `ui/picker.ts`, `composer.ts` |
| 14 | [Public API surface](#14-public-api-surface) | `sdk.ts`, `public-extension-api.ts`, `glrs-core/src/index.ts` |
| 15 | [Build, packaging and release](#15-build-packaging-and-release) | manifests, `bunfig.toml`, `biome.json`, `tsconfig.json`, CI, `infra/`, docs-site build |

## Scope and method

Surveyed: every committed `.ts` under `packages/**` (four packages: `glrs-coding-agent`, `glrs-core`, `provider-registry`, `packages/extensions/{ask-user,builtins,web-fetch,worktree}`), plus `bin/`, root and per-package `package.json`, `bunfig.toml`, `biome.json`, `tsconfig.json`, `.changeset/`, `.npmrc`, CI workflows, `docs-site/` and `infra/` manifests.

**Liveness** here means reachable in normal use from `bin/glrs` → `src/index.ts` (TUI), `src/print.ts` (`-p`), `src/cli.ts` (subcommand host), or loaded as a shipped extension through `src/extensions.ts`. Code reachable only from `*.test.ts` is treated as dead and said so explicitly. "Partial" means reachable only under a condition that cannot be met on main; where a condition *can* be met (a config key, a user-written extension on disk), the entry is live and the gate is named.

Documentation was excluded as evidence by instruction: no `.md`, `.html`, README, CHANGELOG or `.changeset/` prose was used to establish behaviour. Shipped resource files (an extension's `skills/SKILL.md`, markdown command files) are named as artifacts that ship; the loader code is the evidence for what they do.

---

# 1. CLI entry and dispatch

The front door: one binary, argv parsing, and the branch that decides which host runs. `bin/glrs`, `index.ts:108`–`:196`.

## Process entry and argv

- Single executable: `glrs` and the alias `glorious` both exec bun against the coding agent's `index.ts`; `-p` and subcommands are branches inside `main()`, not separate binaries. `bin/glrs:15`, `package.json:37`, `index.ts:112`, `index.ts:1099` — [CLI]
- `--version` prints `glrs <version>` and returns without touching the terminal, config or git — but only when it is the sole argument. `index.ts:114`, `index.ts:75` — [CLI]
- `glrs update` shells `bun add -g @glrs-dev/glrs@next` with inherited stdio; also requires being the only argument, and hard-pins the `next` dist-tag. `index.ts:118`, `index.ts:119`, `index.ts:74` — [CLI]
- `--model provider/id` writes `process.env.GLRS_MODEL` before anything reads a model, so it applies identically to the TUI and `-p`. The value is taken positionally with no flag check: `glrs --model -p hi` sets the model to `"-p"` and still takes the `-p` branch; a trailing `--model` with no value is silently ignored and raises no notice. `index.ts:124`, `index.ts:125`, `index.ts:189`, `models.ts:137` — [CLI, gated `--model`]
- `--resume <id>` opens that session or fails "Session not found: <id>"; bare `--resume` opens the picker; without it a new session is always created. The id is read positionally, so `glrs --resume --model x` fails with "Session not found: --model". `index.ts:181`, `index.ts:235`, `index.ts:236`, `session.ts:118` — [TUI, gated `--resume`]
- Subcommand detection: the first token that does not start with `-` and whose predecessor does not start with `-`. `glrs --model x doctor` finds `doctor`; `glrs wt doctor` finds `wt` and passes `doctor` through as the extension's own argument. `index.ts:156`, `cli.ts:40`, `cli.ts:43` — [CLI]
- Unrecognised `--name value` pairs are collected and dispatched to extension-registered flags after extensions load; unmatched ones print `(unknown flag: --x)` into the transcript, and a handler that throws reports `--name failed: …` as an extension error. The regex is lowercase-only (`/^--([a-z][a-z0-9-]*)$/u`), so `--Foo` is dropped with no notice at all, and a matched flag consumes the next argv token as its value. `index.ts:186`, `index.ts:188`, `index.ts:1013`, `index.ts:1016`, `index.ts:1020`, `extension-api.ts:236` — [CLI + ext API; the `flag.run` half is gated on an extension calling `g.flag()`]
- There is no `--help`. It fails every flag check, is not a bare word, lands in the extra-flag map, opens a full TUI session and prints `(unknown flag: --help)`. `index.ts:188`, `index.ts:1016`; `USAGE` at `index.ts:108` is only ever printed by the unknown-subcommand error at `index.ts:171` — [CLI]
- Any thrown error out of `main()` is written to stderr through `errorText` (which rewrites known-noisy provider/runtime failures into plainer wording) and exits 1; a clean shutdown sets exit code 0 explicitly so a `-p` code cannot leak into a TUI run. `index.ts:1088`, `index.ts:1098`, `index.ts:1101`, `render.ts:71` — [CLI]

## Startup environment probe

- Shells out to `git rev-parse --show-toplevel`, `uname -sr`, `git branch --show-current` and `git status --porcelain`, each failing silently to `""`. The repo root (cwd when not in a repo) becomes the agent root and the search root for config, skills, commands and extensions; the OS string and a `"<branch> clean"` / `"<branch> N files changed"` summary ride the per-turn preamble. The dirty count is a porcelain line count, so it includes untracked files and renames. It runs per host branch (`index.ts:144` for `-p`, `:164` for CLI, `:194` for TUI), not before argv handling. `index.ts:77`, `index.ts:97`, `index.ts:103` — [internal]

## `glrs doctor`

- Prints the resolved plan without executing anything: chosen model label, the provider's display name (or `<id> (OpenAI-compatible)` for an unknown id), missing credentials, every extension that *would* load with its source (disk/bundled/config), and all config + extension-resolution diagnostics. Extensions are resolved from the inert plan, never loaded, so doctor cannot run third-party code. `index.ts:196`, `index.ts:201`, `index.ts:209`, `index.ts:210`, `providers.ts:122`, `extensions.ts:177` — [CLI]
- `--json` anywhere in argv emits the same report as pretty-printed JSON. `index.ts:158`, `index.ts:213` — [CLI, gated `doctor --json`]


### Not on a live path

- `index.ts:176`–`:179` — the bare-word typo rejection uses exactly the predicate `subcommandOf` already used (`cli.ts:43`), so any argv it would reject was already routed to `runCli` and rejected there with the richer message, and the loop is skipped when the subcommand is `doctor`. The loop body runs; the `throw new Error(USAGE)` is unreachable.
- `index.ts:194` — `probe()`'s `branch`, `worktree` and `label` fields are destructured and never read. (Not a feature; a dead local.)
- Two code comments (`cli.ts:120`, `extension-api.ts:171`) describe output of `glrs --help`, which does not exist.
Real, dispatched, reachable by a user-authored extension in `.glrs/extensions/` — but nothing shipped registers against them, so on a stock install the dispatcher always takes its empty branch. `rg` across `packages/extensions/` finds zero uses of: `g.flag`, `g.key`, `g.status`, `g.footer`, `g.activity`, `g.markdown`, `g.events`, `g.filterTools`, `g.send`, `g.setInput`, `g.models`, `g.setModel`, `g.abort`, `g.idle`, `g.pending`, `g.shutdown`, `g.systemPrompt`, `g.setSessionName`.
Consequences on a stock install: `index.ts:686` `onKeyBinding` always returns false; the extra-flag loop at `index.ts:1013` always prints `(unknown flag: …)`; `registry.footers` (`index.ts:338`), `registry.activities` (`index.ts:350`), `registry.statuses` (`index.ts:363`) are always empty and `shown()` (`index.ts:422`) is the identity; `extension-api.ts:700` `filterTools` has zero non-test callers even in-repo (`applyToolBans` pushes into `registry.toolFilters` directly); the entire `registry.bus` (`extension-api.ts:726`) has no emitter and no subscriber; `describeContribution`'s `"N ui"` segment (`extension-api.ts:590`) can never print; `print.ts:127` `capture` throws only for a caller that does not exist (ask-user returns early on `!g.hasUI`); and all 21 `needsSession` throw sites in `cli.ts:81`–`:101` are unreachable, since the only registered subcommand's body touches just `g.print` and `g.root`.
`configure_extension` in `-p` is a special case: it registers (`builtins/src/index.ts:90` — `print.ts:112` supplies a real `available()`), but the preamble that tells the model it exists is TUI-only (`index.ts:394` vs `print.ts:81`) and `print.ts:115` returns `"not-allowed"` unconditionally — a model-callable tool that is undiscoverable and cannot succeed.

---

# 2. Hosts

Three hosts implement the same extension interface with different amounts of it. The TUI is described throughout the rest of this document; this section covers the other two and the differences between all three.

## Headless host (`-p` / `--print`)

- Everything after `-p` is joined with spaces as the prompt; `runPrint`'s return becomes the process exit code and `main()` returns before any terminal code runs. `-p` is matched anywhere in argv and beats a subcommand, so `glrs wt -p hi` runs a headless turn and discards `wt`. `index.ts:129`, `index.ts:136`, `index.ts:145` — [-p]
- Non-TTY stdin is read whole, trimmed and appended inside an `<input>` fence, so `cat log | glrs -p "what failed?"` works and the piped material reads as data. `index.ts:135`, `index.ts:140`, `prompt.ts:6` — [-p]
- Empty combined prompt throws "Nothing to run: -p needs a prompt or piped input." → stderr, exit 1. `index.ts:143` — [-p]
- Output split: assistant text to stdout, the tool trail to stderr, so a redirect keeps the answer clean and `2>&1` interleaves. Tool rows are produced by the same `toolRow` the TUI draws, flattened to text. `print.ts:255`, `print.ts:269`, `print.ts:283` — [-p]
- Reasoning is never printed in `-p` (noise in a pipe) but is announced to extensions via the `reasoning` hook. `print.ts:311` — [-p]
- Headless runs load config, rules, skills (including extension-shipped skill roots), model metadata and all extensions — a tool the agent writes for itself exists when it verifies with `-p`. `print.ts:32`, `print.ts:40`, `print.ts:49`, `print.ts:105` — [-p]
- Per-run cache identity: `sessionId: print-<uuid8>`, deliberately fresh so the provider does not treat unrelated runs as one conversation. `print.ts:69` — [-p]
- Exit code 1 when the turn hit the step limit without finishing (with `[stopped at the step limit without finishing]` on stderr) or when the turn threw; SIGINT aborts the run. `print.ts:198`, `print.ts:329`, `print.ts:334` — [-p]
- Config diagnostics, extension failures/notes and skill warnings are all written to stderr as `[config] …`, `[extension …] …`, `[skill] …`. `print.ts:189`–`print.ts:192` — [-p]

## Extension subcommand host

- Any first bare word other than `doctor` loads extensions in a session-less host and asks whether one registered that subcommand; if so it runs and glrs exits without a session. Extension loading is paid only on this path. `index.ts:163`, `index.ts:165`, `cli.ts:113` — [CLI]
- Unknown subcommand throws the usage line plus an "Added by extensions:" block built from what just loaded; with stock config that block is empty (`cliUsage` returns `""` for an empty list) so the error is `Unknown subcommand 'x'.` + USAGE. `cliUsage` also defaults to 80 columns rather than the real terminal width. `index.ts:170`, `cli.ts:124`, `cli.ts:126`, `cli.ts:128` — [CLI]
- The CLI host reads exactly one registry container (`registry.cli`) and never calls `fire()`. Every `g.on(...)` handler — including `session_start`/`session_end` — is inert under `glrs <subcommand>`, and tools, commands, keys, flags, widgets and markdown transforms registered there are silently dropped. `cli.ts:110`, `cli.ts:113` — [CLI]
- The only shipped subcommand is `wt` from the `worktree` extension, which is `defaultOn: false`, so the success path requires config naming `worktree` (or `@glrs-dev/glrs-ext-worktree`) in `extensions.load`, or a user extension calling `g.cli()`. `worktree/src/index.ts:76`, `extensions.ts:100`–`:108` — [CLI, gated `extensions.load`]

## Capability matrix

- `g.mode` is `"tui" | "print" | "cli"`, and the three hosts implement the same interface with different amounts of it. `extension-api.ts:356`, `index.ts:810`, `print.ts:147`, `cli.ts:64` — [ext API]
- CLI host: 21 members throw `g.<member>() needs a session, and a glrs subcommand runs outside one`; `inspect` returns empty arrays and `setExtension` returns `"not-allowed"` instead of throwing. `cli.ts:20`, `cli.ts:78`, `cli.ts:79`, `cli.ts:81`–`:102` — [CLI]
- Print host: `send`, `setInput`, `setExtension`, `reload` note to stderr and continue; `ui.capture`, `models` and `setModel` throw; `clear` returns `"empty"`, `compact` returns `"too-short"`, `session()` returns a stub, `appendEntry` is a no-op and `entries()` returns `[]`. Eight registrars (`command`, `key`, `flag`, `status`, `footer`, `activity`, `markdown`, per-tool renderers) are accepted and silently never dispatched. `print.ts:115`–`:184` — [-p]


### Not on a live path

- `cli.ts:46` — `args[at] ?? ""` is guarded by `at < 0 ? null : …`, so the fallback is dead.

---

# 3. Configuration

Config file discovery, layering and validation, plus the one path by which the agent may write config back. `provider-registry/src/config.ts`, `writeconfig.ts`.

## Files and precedence

- Eight config paths, project first then personal, each spelling read in both `.glrs` and `.glorious` form: `<root>/.glrs/config.local.json`, `<root>/.glrs/config.json`, the two `.glorious` equivalents, `~/.glrs/config.json`, `~/.config/glrs/config.json`, and the two `glorious` personal ones. Project paths all precede personal ones regardless of spelling. `config.ts:80`–`:92` — [config]
- Merge is nearest-wins per key, except `extensions.load`/`disable`, which union across files, and `agentConfigAllowlist`, which is nearest-only (a cloned project cannot widen write permission). `config.ts:280`, `config.ts:298`, `config.ts:306`, `config.ts:347` — [config]
- Every parse/shape problem becomes a diagnostic string rather than a silent drop — wrong-typed keys, per-entry list validation, and a whole-file "none of these keys mean anything here" note for files written for another agent. Diagnostics reach `glrs doctor`, stderr under `-p`, and the TUI transcript as `(config) …` notices at startup. `config.ts:148`, `config.ts:176`, `config.ts:255`, `index.ts:1004`, `print.ts:192` — [config]
- Env override for any setting: `GLRS_<NAME>` first, then `GLORIOUS_<NAME>`. `config.ts:97` — [config]

## Recognised keys

- `model` (`"provider/model-id"`, bare id means azure), `variant` (reasoning effort), `tool_timeout_ms`, `steering_mode`, `follow_up_mode`, `agentConfigAllowlist`, `extensions.load` / `extensions.disable`, `tools.disable`, `providers.<id>.{api,region,project,location}`. `config.ts:43`–`:62`, `config.ts:10`–`:19` — [config]
- Queue modes accept `one-at-a-time` (default) or `all`, and both snake_case and camelCase spellings are read, with the diagnostic reported under whichever spelling was written. `config.ts:109`, `config.ts:111`, `config.ts:164` — [config, gated `steering_mode` / `follow_up_mode`]
- `tool_timeout_ms`: `GLRS_TOOL_TIMEOUT_MS` wins only when it parses finite and > 0, otherwise config, otherwise the tool default; the resolved value is what `g.settings()` reports and what the builtins tools are constructed with. `index.ts:241`, `index.ts:242`, `index.ts:829`, `print.ts:54`, `builtins/src/index.ts:84` — [config]
- `tools.disable` withholds named tools from the model whichever extension registered them, pushed as one more entry on the filter list so it intersects with extension filters rather than overwriting them; re-applied after `/reload` because the registry reset clears filters. `index.ts:988`, `index.ts:990`, `index.ts:995`, `index.ts:966`, `agent.ts:293`, `print.ts:196` — [config, gated `tools.disable`]

## Agent-written config

- `g.setExtension(name, on)` writes `<root>/.glrs/config.json` — adding the name to `load` and removing it from `disable`, or the reverse — only when `"extensions"` appears in `agentConfigAllowlist`; otherwise `"not-allowed"`. Unknown names return `"unknown"`, no-ops return `"already"`, write failures `"failed"`. On success the in-memory config is updated immediately so the per-turn advertisement and the next `/reload` agree with the file. The write is a JSON round-trip, so hand formatting and comments do not survive. `index.ts:814`, `index.ts:816`, `index.ts:820`, `writeconfig.ts:16`, `writeconfig.ts:48`, `writeconfig.ts:54`, `writeconfig.ts:70` — [ext API, gated `agentConfigAllowlist: ["extensions"]`]
- Under `-p`, `setExtension` unconditionally returns `"not-allowed"` with a stderr note. `print.ts:115` — [-p]


### Not on a live path

- `config.ts:205` — `keys[0] ?? "load"`: `listBlock` is only ever called with a non-empty key list (`config.ts:230`, `:235`).

---

# 4. Models and providers

Which model runs, which provider serves it, what it costs. `provider-registry/src/models.ts`, `providers.ts`.

## Selection

- Model resolution order: `GLRS_MODEL`/`GLORIOUS_MODEL`, then `config.model`, then the built-in default `"gpt-5.6-luna"`; a bare id gets provider `azure`. `models.ts:136`, `models.ts:137`, `models.ts:83` — [config]
- `variant` (reasoning effort) comes from `GLRS_VARIANT` or config and is sent as `reasoningEffort` inside the `openai` provider-options namespace only. `models.ts:143`, `agent.ts:211`, `agent.ts:250` — [config, gated `variant`]
- 16 providers with display labels, credential env vars in precedence order, and extra requirements: anthropic, openai, azure, google, google-vertex, amazon-bedrock, openrouter, groq, mistral, deepseek, cerebras, cohere, xai, perplexity, togetherai. `providers.ts:25`–`:73` — [config]
- Alias table for what people actually type — `vertex`, `gemini`, `bedrock`, `aws`, `claude`, `azure-openai`, `foundry`, `together`, `grok`, `open-router`, and more. `providers.ts:98`, `providers.ts:~80` — [config]
- Unknown provider ids are treated as OpenAI-compatible endpoints (Ollama, LM Studio, vLLM, a gateway) needing only `providers.<id>.api`; a near-miss id is named back instead. `models.ts:276`, `providers.ts:106` — [config]
- `missingFor` reports which credential variables are absent and what else is needed, driving doctor's `missing:` lines. `providers.ts:122` — [CLI]

## Catalogue metadata and cost

- `modelMetadata` fetches models.dev once at startup and merges context window, per-token pricing and reasoning variants into the live model, then hands it to the agent and repaints. Failure is swallowed: offline the status line reads `unknown` and everything else runs. `index.ts:778`, `index.ts:780`, `models.ts:189`, `print.ts:52` — [TUI, -p]
- The catalogue is cached to `$XDG_CACHE_HOME/glrs/models.dev.json` (or `~/.cache/...`) on every successful fetch and read back when the fetch fails, with a 10s request timeout. `models.ts:52`, `models.ts:64`, `models.ts:72` — [internal]
- Per-step cost is computed from the merged pricing with a per-provider multiplier; absent pricing yields no cost rather than zero. `agent.ts:434`, `models.ts:95`, `models.ts:104` — [internal]
- `loadCatalogue()` exposes the whole catalogue to extensions that want to build a model picker; the core ships none. `models.ts:155`, `index.ts:877` — [ext API]
- `g.setModel(label, variant)` rebuilds the model option from config, merges freshly fetched metadata (silently skipped on failure), hands it to the agent, fires `model_select` and repaints. `index.ts:887`, `index.ts:890` — [ext API]

## Provider HTTP seam

- Every provider request goes through `providerFetch`, which fires `before_provider_request` with URL, headers object and parsed JSON body; returned headers merge, a returned body replaces outright. A non-string body passes through as `undefined`; a body that will not parse passes through as its raw string. `agent.ts:169`, `agent.ts:177`, `agent.ts:182`, `index.ts:405`, `print.ts:86` — [ext API]
- `after_provider_response` reports URL, status and response headers, fire-and-forget, before the body is read — one pair per `providerFetch` call, so internal deadline retries do not each produce one. `agent.ts:192`, `index.ts:409`, `print.ts:90` — [ext API]


### Not on a live path

- `createProviderRegistry` (`provider-registry/src/index.ts:25`) — only caller is `provider-registry/src/index.test.ts:6`. Test-only ⇒ dead. (The surrounding module is live via its `export *` barrel.)
- `compatibleNote` (`providers.ts:118`) — zero references repo-wide; `missingFor` builds the same message inline at `providers.ts:132` and `createModel` a third copy at `models.ts:287`.
- `ProviderSpec.note` (`providers.ts:22`) — written for google-vertex (`:55`, ADC guidance) and amazon-bedrock (`:62`, AWS credential chain) and read by nobody. `missingFor` uses only `env` and `needs`; doctor prints only `report.missing`. **Small wire-up: append `spec.note` to doctor's missing lines.**
- `providers.amazon-bedrock.api` and `providers.google-vertex.api` — shaped and merged (`config.ts:251`, `:309`) but `providerSettings` returns only `{region}` for bedrock (`models.ts:118`) and `{project, location}` for vertex (`models.ts:123`). Executed check: the `api` key is absent from the resulting model option. For vertex, `createGoogleVertex` (`models.ts:269`) is never given a `baseURL` at all.
- `providers.azure.api` — survives into the model option, but `createModel`'s azure branch is `createAzure({apiKey, fetch})(modelId)` with **no `baseURL`** (`models.ts:260`), unlike every other branch. Azure is the default provider (`models.ts:85`, `:137`), so the most likely provider is the one where a base URL silently does nothing. **One-line wire-up.**
- `region` / `project` / `location` accepted for every provider name (`config.ts:249`) but handed out only for their own provider — silently dropped for the rest, with no diagnostic.
- `ModelOption.apiKey` (`models.ts:32`) is read by `resolveApiKey` (`models.ts:256`) and assigned by nothing anywhere. There is no config key for an API key at all; credentials are environment-only.
- `variant` reaches only the `openai` provider-options namespace (`agent.ts:250`). The openai SDK also answers to `azure`, so azure and openai work; anthropic (`provider: "anthropic"`), bedrock, vertex and every OpenAI-compatible endpoint receive nothing. `{"model":"anthropic/…","variant":"high"}` parses, passes doctor, and has no effect.
- `providers.ts:139` — `spec.env.length > 0` is always true; executed check: no entry in `PROVIDERS` has an empty `env`, and the array is a module-level const with no mutation site.
- `providers.ts:143` — `!first.includes(".")` is always true; executed check: the three `needs` firsts are `AZURE_RESOURCE_NAME`, `GOOGLE_CLOUD_PROJECT`, `AWS_REGION`, none containing a dot.
- `models.ts:232` and `:238` — the `amazon-bedrock` and `google-vertex` entries of the provider factory map can never be selected; `createModel` returns for both providers at `models.ts:262` and `:269` before the map is consulted at `:276`.

---

# 5. Sessions and the event log

Every session is a JSON event log on disk; resume replays it. `glrs-core/src/session.ts`, `events.ts`.

## Store and lifecycle

- Sessions are plain JSON under `$XDG_DATA_HOME/glrs/sessions` (or `~/.local/share/glrs/sessions`), created with an 8-character id, cwd and timestamps, and written immediately so a session that crashes on its first turn still exists. `index.ts:236`, `session.ts:14`, `session.ts:132` — [TUI]
- Reads come from both the current `glrs` store and the legacy `glorious` one, deduped by id with the new copy winning; writes only ever go to the new one, so resuming an old session migrates it. Prompt history follows the same read-old/write-new rule. `session.ts:21`, `session.ts:27`, `session.ts:108`, `session.ts:145`, `session.ts:189` — [internal]
- Interactive picker on bare `--resume`: every readable session newest-updated first, each row showing a derived title (last user message, whitespace-collapsed, first 72 chars), id and cwd. Escape aborts the run with "Session selection cancelled."; an empty store errors "No sessions to resume." `index.ts:236`, `ui/picker.ts:4`, `session.ts:63`, `session.ts:128` — [TUI, gated `--resume` with no id]

## Event log, migration and replay

- A stored session without `schema: 2` is converted on read into user/assistant display events plus one `turn` event carrying the raw messages, so pre-event-log sessions still resume and replay. `session.ts:80`, `events.ts:123` — [internal]
- Event kinds: `user` (with an optional `steer` flag), `assistant`, `tool` (with optional `input`/`result` for extension re-rendering), `reasoning` (full text kept), `notice`, `error`, `usage`, `turn`, `cleared`, `compacted`, and `custom` (an extension's own data, never sent to the model). `events.ts:5`–`:49` — [internal]
- Full transcript replay on resume before the screen starts: every stored event is rendered into scrollback and consecutive tool calls get their run footer exactly as they did live. Extensions have **not** loaded at replay time (`loadAllExtensions` runs at `index.ts:994`), so `renderTool` returns undefined and the markdown transform chain is the identity — a replayed transcript always gets glrs's default rendering, and it is printed once into scrollback rather than re-rendered on later paints. `index.ts:762`, `index.ts:763`, `index.ts:767`, `index.ts:773`, `render.ts:378`, `render.ts:319` — [TUI]
- What the *model* replays restarts at the last `cleared`/`compacted` event, carrying only the compaction brief forward; the on-screen transcript replays everything. Clearing drops what the model sees without erasing scrollback. `index.ts:798`, `events.ts:51`, `events.ts:52`, `events.ts:64` — [TUI]
- Preamble stripping on replay: `PREAMBLE_TAGS` (`where-you-are`, `skills`, `extensions`) plus the `[system-reminder]` bracket pair are stripped from the head of user messages in a loop, so a replayed message shows only what the user typed. A new preamble block added without a matching tag entry will replay as if the user typed it; nothing enforces the pairing. `events.ts:3`, `events.ts:109`, `events.ts:127`, `prompt.ts:1` — [internal]

## Persistence and accounting

- The session file is written only on `usage` and `turn` events, on turn end, and at idle; notices, errors and custom entries land in memory and reach disk on the next such event. Writes are fire-and-forget (`void saveSession`), so two can overlap. `index.ts:414`, `index.ts:417`, `index.ts:537` — [internal]
- Context-token count survives a resume: seeded from stored `contextTokens`, falling back to the last `usage` event, so the status gauge is correct immediately. `index.ts:262`, `index.ts:263`, `index.ts:432` — [TUI]
- `g.usage()` returns current context tokens, the model's window, the last call's input/output/cached/cost and lifetime totals summed over every usage event in the session — totals do not reset at a clear or compaction. `index.ts:903`, `events.ts:79` — [ext API]
- `g.appendEntry(type, data)` records a `custom` event; `g.entries(type)` reads them back out of the session's own events, so extension state survives a resume without a second store. It reaches disk on the next usage/turn event or at idle. `index.ts:923`, `index.ts:928` — [ext API]
- Prompt history is loaded once at startup and written back on every submit into a shared `prompts.json`, so up-arrow recall is per-user and crosses sessions. `index.ts:237`, `index.ts:546`, `session.ts:187`, `session.ts:215` — [TUI]

## Shutdown

- Quit aborts any running turn, fires `session_end` and only releases the main promise once every handler settles — an extension writing a file on the way out finishes, though it cannot usefully print, since the screen tears down as soon as the promise resolves. `index.ts:1045`, `index.ts:1058`, `index.ts:1060`, `index.ts:1094` — [TUI]
- SIGINT interrupts first: `chat.abort()` returns true when it stopped a turn or found a queue to hold; when it returns false the same press quits. Both the handler and the repaint ticker are removed in the `finally`. `index.ts:1063`, `index.ts:1084`, `index.ts:1091`, `chat.ts:377` — [TUI]
- `unhandledRejection` and `uncaughtException` are captured and rendered as ordinary error events in the transcript instead of writing a stack trace over the alternate screen; both handlers are removed on teardown. An uncaught exception is swallowed and the process keeps running. `index.ts:1077`, `index.ts:1085`, `index.ts:1086` — [TUI]


### Not on a live path

- **Session forking.** `forkSession` (`session.ts:169`–`:185`) slices events at an index, mints a fresh id, recomputes `contextTokens` and saves — 17 complete lines. Its only reference is the `fork:` property of `jsonSessionRepository` (`session.ts:211`), whose only reference is dead `sdk.ts`. Same for `appendSessionEvents` (`session.ts:158`, referenced only at `session.ts:210`) and the `SessionRepository` type (`session.ts:197`). The live path imports six session functions directly at `index.ts:6`–`:13` and skips the abstraction. **Wiring cost: one import plus one command handler.**

---

# 6. Shell execution

One shell implementation serves the `bash` tool, the `!` composer mode and the worktree extension. `glrs-core/src/shell.ts`, `direct-shell.ts`.

## Process control

- Shell process control (shared by tools, the `!` command and worktree): detached process group, SIGTERM on deadline or caller abort with SIGKILL escalation after a grace period, line-capped stdout draining, and `[interrupted]` / `[timed out after Ns]` notes. `runShell` additionally keeps stdout and stderr apart and reports a real exit code (128+n for signals) so an extension can tell exit 1 from exit 127. `shell.ts:34`, `shell.ts:61`, `shell.ts:103` — [internal]
- Shell arguments are passed as real positional parameters (`bash -lc <cmd> glrs <args…>`), so `$1`/`$@` work without quoting. `shell.ts:108` — [internal]

## Direct shell (`!command`)

- A line starting with `!` puts the composer in shell mode (backspace on an empty line leaves it), echoes as a user block, fires `user_bash`, adds a running row, and streams output live: stdout muted, stderr under a `stderr:` header in the warning tone. `index.ts:584`, `index.ts:586`, `ui/screen.ts:419`, `ui/screen.ts:464` — [TUI]
- Output is ANSI-stripped with carriage returns turned into newlines, batched on an 80 ms timer, and capped at 30,000 characters with one `[output truncated at 30,000 characters]` line. `index.ts:613`, `index.ts:617`, `index.ts:633`, `direct-shell.ts:3` — [TUI]
- Completion messages distinguish the three outcomes: exit 0 with no output → `(shell command completed with no output)`; non-zero → the last output line or `exit N` in danger tone; failure to launch → `(shell command failed to run — …)`. `index.ts:643`, `direct-shell.ts:8` — [TUI]


---

# 7. Agent turn loop

The model call, what streams out of it, and everything that can interrupt or redirect it mid-flight. `agent.ts`, `chat.ts`, `queue.ts`.

## Model call and streaming

- Hard step limit of 100 per turn; exhaustion with no closing text sets `stoppedAtStepLimit`, which the TUI reports as `(step limit reached — send "continue" to resume)` plus a system-reminder for the next turn, and `-p` reports on stderr with exit 1. A turn that hits 100 steps but still produces closing text reports nothing. `agent.ts:8`, `agent.ts:248`, `agent.ts:494`, `chat.ts:222`, `print.ts:320` — [TUI, -p]
- AI-SDK-level `maxRetries: 5` per model call, underneath glrs's own two retry layers. `agent.ts:249` — [internal]
- Text deltas stream to the caller as they arrive; reasoning arrives as its own delta kind, accumulates per block, and on reasoning-end is reported once with elapsed wall-clock time (skipped when all whitespace). `agent.ts:456`, `agent.ts:462`, `agent.ts:477`, `chat.ts:163`, `chat.ts:179` — [TUI, -p]
- Four in-flight phases — sending, waiting, thinking, writing — reported for the activity row and stood down at each step boundary; `-p` passes an empty `onPhase`. `agent.ts:44`, `agent.ts:398`, `agent.ts:426`, `agent.ts:476`, `print.ts:316` — [TUI]
- Per-step usage: context tokens, cached tokens, output tokens and computed cost; a later call that returns no input count reuses the last observed one so the gauge does not flicker to empty. `agent.ts:204`, `agent.ts:427`, `agent.ts:428`, `chat.ts:188`, `print.ts:296` — [internal]
- The SDK's default `console.error` handler is replaced with a no-op and stream errors are re-thrown out of iteration, so a failure never prints over the alternate screen. Trailing promises (`text`, `responseMessages`, `steps`) are subscribed with catch handlers before the stream is drained so a failed turn leaves no unhandled rejections. `agent.ts:162`, `agent.ts:424`, `agent.ts:442`, `agent.ts:452` — [internal]
- A finished turn returns the whole conversation (prior history + this turn's user message + response messages with steering re-inserted); the caller replaces history wholesale and stores the sliced tail as one `turn` event. `agent.ts:487`, `chat.ts:215`, `chat.ts:216` — [internal]

## Request shaping and prompt caching

- The system prompt is deliberately static: identity, guidelines, a pointer to glrs's own docs directory, and the fenced `<repo-rules>` block — nothing volatile, so the provider's prompt cache keeps hitting. `prompt.ts:42`, `prompt.ts:46`, `prompt.ts:94` — [internal]
- Prompt cache key: `sha256("<root> <scope>")` truncated to 32 hex chars; the turn scope is the session id, compaction uses its own `"compact"` scope so summarising never evicts the conversation's prefix. `agent.ts:36`, `agent.ts:207`, `agent.ts:250`, `agent.ts:275` — [internal]
- Provider options carry `reasoningEffort`, `textVerbosity`, `promptCacheKey` and `store: false`, all nested under the `openai` namespace. `agent.ts:155`, `agent.ts:250` — [internal]

## Steering and the queue

- Enter queues a follow-up, delivered when the agent runs out of work; Alt+Enter steers the turn already running, delivered at the next step boundary. With nothing running, a steering message simply becomes the turn. `index.ts:554`, `ui/screen.ts:475`, `chat.ts:344` — [TUI]
- Before each model step the turn asks the caller for steering and appends it as a user message from that step onward; nothing earlier is rewritten, so the cached prefix survives. Several messages taken at one boundary are joined with blank lines into a single message. `agent.ts:411`, `agent.ts:414`, `agent.ts:419`, `chat.ts:128`, `chat.ts:139` — [TUI]
- Steering is spliced back into the stored transcript at the position it arrived — the SDK appends it outside both the sent list and the response list, so without this it would vanish and a later compaction would summarise the assistant answering before the question. Insertions are applied newest-first over a stable sort so equal positions keep injection order, and out-of-range indices are clamped. `agent.ts:67`, `agent.ts:76`, `agent.ts:77`, `agent.ts:418`, `agent.ts:493` — [internal]
- Queue delivery granularity is per queue: `steering_mode` and `follow_up_mode` choose oldest-first or everything-at-once, defaulting to one at a time. `index.ts:799`, `index.ts:800`, `chat.ts:65`, `queue.ts:42`, `queue.ts:51` — [config]
- Alt+Up takes the newest queued message back into the composer, using its label (so a slash command returns as `/review`, not the expanded body). `index.ts:579`, `index.ts:581`, `chat.ts:388`, `queue.ts:67`, `ui/screen.ts:481` — [TUI]
- Enter on an empty composer releases a held queue and does nothing otherwise; it never reaches the extension `input` hook. `index.ts:558`, `chat.ts:350`, `ui/screen.ts:398` — [TUI]
- Queued and held messages are drawn above the composer, labelled `steering:` or `queued:`, plus a held row saying how many wait and that Enter releases them. `index.ts:334`, `index.ts:336`, `render.ts:456`, `render.ts:465` — [TUI]
- Steering messages are recorded and displayed but do not reset the `produced` flag and do not fire `turn_start` — so a turn that already ran tools cannot report "(no response)" because the user steered it, and extensions are not told a new turn began mid-turn. `index.ts:451`, `index.ts:453`, `events.ts:10` — [TUI]
- No steering in `-p`: the print host supplies no `onSteer`, so `prepareStep` returns `{}` on every step. `agent.ts:334`, `agent.ts:412`, `print.ts:243` — [-p]
- When a turn drains, leftover steering is moved to the front of the follow-up queue rather than discarded, then `idle` fires. `chat.ts:232`, `chat.ts:233` — [TUI]

## Interrupt, retry and rollback

- Esc aborts the running model call through the same signal the fetch layer respects; the turn resolves as interrupted rather than erroring. The same controller slot holds a running compaction, so Esc stops a minutes-long summarising call too. `chat.ts:72`, `chat.ts:115`, `chat.ts:208`, `chat.ts:269`, `agent.ts:407`, `index.ts:705`, `index.ts:1053` — [TUI]
- Esc also holds the queue if anything is waiting, so a message queued two minutes ago does not fire into whatever state the interrupt left behind; sending anything, or Enter on an empty line, releases it. A held queue reports `held` but not `busy`, so no "Esc to interrupt" row is drawn over a session sitting still. `chat.ts:62`, `chat.ts:291`, `chat.ts:314`, `chat.ts:325`, `chat.ts:380` — [TUI]
- After an interrupt, a system-reminder naming the first 160 characters of what was being answered is stashed and appended *after* the user's next message (leading it made the model answer the reminder instead of the request). A turn that threw leaves the same kind of reminder with the error text. `chat.ts:150`, `chat.ts:202`, `chat.ts:209`, `chat.ts:211`, `prompt.ts:30` — [TUI]
- Per-request deadline chain: 30 minutes, then two 10-minute retries with escalating pauses; the caller's abort wins over the deadline retry, checked both before sleeping and after waking. `agent.ts:9`, `agent.ts:88`, `agent.ts:98`, `agent.ts:101`, `agent.ts:103` — [internal]
- Transient-failure classification: `TypeError`, four timeout/connection error names, or an errno from a fixed set. `ENOTFOUND` is deliberately excluded so a wrong base URL fails fast. `agent.ts:11`, `agent.ts:22`, `agent.ts:81` — [internal]
- A stream that dies while the body is being read restarts the whole turn from step one, up to three times (four sends total) with growing pauses — but only while the attempt is unobservable: no text, no reasoning, no tool call, and no user abort. Once a tool has run, the failure surfaces. `agent.ts:39`, `agent.ts:50`, `agent.ts:369`, `agent.ts:377`, `agent.ts:386`, `agent.ts:455` — [internal]
- Retries are announced: the TUI prints `(connection dropped — re-sending, attempt N: …)`, `-p` writes `[retry N] connection dropped: …` to stderr. `agent.ts:385`, `chat.ts:174`, `print.ts:317` — [TUI, -p]
- Steering the dying attempt had already consumed is pushed back onto the front of the queue in original order, and messages already echoed are not echoed twice (tracked by id). `chat.ts:121`, `chat.ts:124`, `chat.ts:135`, `chat.ts:172` — [TUI]

## Compaction

- Automatic compaction when the provider's own token count passes 75% of the model's window, with a guard remembering the token count at the last compaction so one that freed little does not re-run next turn. Nothing happens when the context size is unknown. `index.ts:713`, `index.ts:749`, `index.ts:754`, `index.ts:531` — [TUI]
- The cut must land on a user message (a tool result separated from its call is an invalid request); the walk-back keeps at least 20,000 tokens by a 4-chars-per-token estimate. Manual compaction passes `force`, cutting at the last user boundary even when nothing satisfies the keep target — without it `/compact` declined on every conversation short of the automatic threshold. `chat.ts:238`, `chat.ts:243`, `chat.ts:252`, `index.ts:717`, `index.ts:727`, `index.ts:932` — [TUI, ext API]
- The summarising call is a separate no-tools `generateText` with a fixed brief-writing instruction, `maxOutputTokens: 4000`, its own cache scope, and its own abort controller; the result replaces the cut prefix with one `compactedPrompt` user message. `agent.ts:258`, `agent.ts:275`, `chat.ts:271`, `events.ts:64` — [internal]
- Compaction counts as busy for the activity row and rides the phase signal, so the one operation that can run for minutes is not invisible. `chat.ts:269`, `index.ts:341` — [TUI]
- A successful compaction prints `(compacted — N messages summarised, M kept, from T tokens)` and fires the `compact` event with dropped/kept/automatic; a failure prints `(compaction failed: …)` as an error. `index.ts:721`, `index.ts:731`, `index.ts:737`, `index.ts:743` — [TUI, ext API]
- Under `-p`, `compact` is stubbed to `{outcome: "too-short"}` and the `compact` event never fires. `print.ts:141` — [-p]


### Not on a live path

- `QUEUE_MODES` / `isQueueMode` (`queue.ts:34`, `queue.ts:37`) — referenced only by each other and `queue.test.ts`. Config validates queue modes with its own private duplicate at `config.ts:109`/`:111`.
- No `cacheControl`/`cache_control` anywhere in non-test source: the whole prompt-cache discipline is OpenAI-shaped, and `store:false` is likewise ignored outside OpenAI.
- `agent.ts:237` — `if (filters.length === 0) return all` is unreachable in the TUI: `applyToolBans` (`index.ts:988`–`:991`) pushes a predicate and calls `setToolFilters` unconditionally, even with no `tools.disable`, at startup (`:995`) and on reload (`:966`). Still live in `-p`, where `print.ts:196` only sets filters when the ban list is non-empty.

---

# 8. Prompt and context assembly

What reaches the model each turn and where every piece of it comes from. `prompt.ts`, `guidance.ts`, `mentions.ts`.

## Per-turn assembly

- Project rules: `AGENTS.md` / `AGENT.md` / `CLAUDE.md` collected from system locations, `~/.config/amp/AGENTS.md`, `~/.config/AGENTS.md`, then every directory from home down to the root (nearest last), deduped by path, concatenated, and fenced into the system prompt as `<repo-rules>`. `index.ts:238`, `guidance.ts:28`, `guidance.ts:36`, `prompt.ts:94` — [TUI, -p]
- The same loader is called with a second `location` argument by the `read` tool, so reading a file also returns the AGENTS.md guidance that governs its directory. `builtins/src/tools.ts:122`, `guidance.ts:36` — [internal]
- Volatile context rides the per-turn user message, never the system prompt: `<where-you-are>` (OS, date, cwd, git state) and the `<skills>` catalogue, computed once at agent construction and prepended to every turn. `agent.ts:205`, `agent.ts:347`, `prompt.ts:97`, `prompt.ts:107` — [internal]
- Exactly one user message is appended per turn — preamble, optional `<extensions>` block, prompt — joined by blank lines with empty parts dropped; history itself is never rewritten. `agent.ts:342`, `agent.ts:353` — [internal]
- Extension prompt contributions are re-evaluated every turn: a string is taken as-is, a function is called fresh, and one that throws or returns `""` loses only its own line. `index.ts:392`, `agent.ts:340`, `extension-api.ts:570` — [ext API]
- Undecided shipped extensions are advertised to the model each turn; when `"extensions"` is in `agentConfigAllowlist` the model is told to record the answer with `configure_extension`, otherwise to ask the user to edit `.glrs/config.json`. The block disappears once every shipped extension is decided. Wired only into the TUI — `print.ts:81` passes prompt contributions alone. `index.ts:394`, `available.ts:16`, `available.ts:20`, `extensions.ts:131` — [TUI]
- Fence and reminder escaping: any closing delimiter inside a fenced body is rewritten with a U+2215 homoglyph, so attached file contents or piped stdin cannot forge a block boundary. `prompt.ts:7`, `prompt.ts:31` — [internal]

## `@` mentions

- `@path` expands into file contents (or, for a directory, a ripgrep-derived listing capped at 200 entries with a `[N more]` marker) attached in a `<mentioned-files>` fence, while the transcript label stays exactly what was typed. Up to 10 mentions per message, 100,000 characters per file with a `[truncated]` marker, paths confined to the project (an escaping path is left as prose, which is what an email address gets). Unresolved mentions print `(no such file: @path — sent as text)` and do not fail the send. `index.ts:569`, `index.ts:570`, `index.ts:572`, `mentions.ts:19`, `mentions.ts:30`, `mentions.ts:38`, `mentions.ts:60`, `mentions.ts:102`, `print.ts:235` — [TUI, -p]
- `@` completion is backed by a ripgrep file listing cached for 5 seconds and capped at 20,000 paths, with implied directories derived from the file list, ranked by match position and path depth and capped at 50. It respects `.gitignore` and additionally excludes `.git`, `node_modules`, `dist`, `build`, `.next`, `coverage`, `.turbo`; a hand-walk fallback covers a missing or refusing ripgrep. `index.ts:551`, `mentions.ts:12`, `mentions.ts:118`, `mentions.ts:129`, `mentions.ts:183`, `mentions.ts:191` — [TUI]


### Not on a live path

- `mentions.ts:212` `forgetListings` — imported only by `mentions.test.ts`; the listing cache has no invalidation hook in any host.
- `loadAgentRules` reads `/etc/ampcode/AGENTS.md`, `/Library/Application Support/ampcode/AGENTS.md`, `%ProgramData%/ampcode/AGENTS.md` and `~/.config/amp/AGENTS.md` (`guidance.ts:28`–`:34`, `:43`) — live, but there is no glrs-owned equivalent, so a machine-wide glrs rules file cannot be installed.

---

# 9. Skills and commands

Discovered from disk, merged into one namespace, reachable as slash commands and — for skills — as a model tool. `skills.ts`, `commands.ts`, `usercommands.ts`.

## Skills

- Skill roots, in order: `~/.config/agents/skills`, `~/.agents/skills`, every ancestor from the root up to `$HOME` as `<dir>/.agents/skills`, `<root>/.glrs/skills`, `<root>/.glorious/skills`, then each loaded extension's `skills/` directory — deduped, first root to claim a name wins. `skills.ts:104` — [TUI, -p]
- A skill is any directory containing `SKILL.md`, found by a bounded recursive walk (max depth 4, skipping `node_modules`, `.git`, `scripts`, `references`, `assets`); a directory that is itself a skill is not searched further. `skills.ts:246`, `skills.ts:247`, `skills.ts:249` — [internal]
- Frontmatter parsed: `name`, `description`, `trigger`, `license`, `compatibility`, `allowed-tools`, `disable-model-invocation`, plus a `metadata` map; unknown fields are ignored so a skill written for another agent loads. `skills.ts:129`, `skills.ts:141` — [internal]
- Validation is lenient and loud: missing name or description refuses the skill; an over-long name, a non-standard name shape, an over-long description or compatibility string, a folder/name mismatch, and duplicate names all warn and still load. Warnings surface as `(skill) …` notices in the TUI and `[skill] …` on stderr in `-p`. `skills.ts:198`–`:220`, `skills.ts:284`, `skills.ts:290`, `index.ts:1009`, `print.ts:191` — [TUI, -p]
- `disable-model-invocation: true` removes a skill from the `<skills>` catalogue *and* from `activate_skill`, leaving the slash command as the only way in. `skills.ts:54`, `skills.ts:342`, `skills.ts:383` — [config-in-resource]
- Every skill gets a namespaced slash command `/skill:<name>` (or `/skill:<trigger>`), so installing a skill cannot shadow an existing command. Typing it sends a framed "Run the <name> skill now… these are instructions, not background material" prompt with the body inlined. `skills.ts:64`, `skills.ts:312`, `skills.ts:369` — [TUI]
- The model-facing catalogue is an `<available_skills>` XML block of name/description/location for model-invocable skills only, XML-escaped, injected in the per-turn preamble. `skills.ts:346`, `prompt.ts:97` — [internal]
- Extension-shipped skills load at startup from the inert extension plan, hundreds of lines before extensions run, so they are available from the first turn. The TUI and `-p` do this; the CLI host never calls `loadSkills`. `index.ts:249`, `index.ts:252`, `print.ts:40`, `extensions.ts:293` — [TUI, -p]

## Command table and dispatch

- One table merges extension commands, skill commands and markdown command files, with a single collision rule — first name registered wins, later duplicates dropped. The core registers no commands of its own. `index.ts:259`, `index.ts:996`, `commands.ts:12`, `commands.ts:19` — [TUI]
- `/name` dispatch order: an extension-registered runner (echoed and run without starting a turn; a throw reports `/name failed: …`), else a body-carrying command (markdown file or skill) whose expanded body becomes the turn labelled with what was typed, else `(unknown command: /name — /help lists what exists)`. `index.ts:657`, `index.ts:660`, `index.ts:675`, `index.ts:683`, `commands.ts:32` — [TUI]
- Command names may contain `:` so skills can live under their own prefix; without that `/skill:graphify` parsed as nothing. `commands.ts:102`, `commands.ts:106` — [internal]
- `expandCommand` substitutes arguments into the body, appending them marked rather than dropping them when the body has no placeholder. `commands.ts:32`, `commands.ts:40` — [internal]
- Fuzzy command matching scores by match position for the completion menu. `commands.ts:45`, `commands.ts:68`, `commands.ts:76` — [TUI]

## Markdown command files

- `<dir>/.glrs/commands/*.md`, `.glorious/commands`, `.agents/commands` for every ancestor up to `$HOME`, plus `~/.config/agents/commands`. First directory to define a name wins, so a project command shadows a personal one. `usercommands.ts:11`, `usercommands.ts:35`, `usercommands.ts:92` — [TUI]
- A file is frontmatter plus body; the body is the prompt. Files with no frontmatter, or unterminated frontmatter, are still valid — the whole file is the prompt — and a missing `description:` becomes "Run the `<name>` command". `usercommands.ts:51` — [TUI]


### Not on a live path

- Skill frontmatter `license` (`skills.ts:17`, parsed `:227`) and `metadata` (`:20`, parsed `:230`) never leave the private `Skill` type — they are not in `SkillSummary`, so nothing can read them. `allowedTools` (`:229`) and `compatibility` (`:217`) reach `SkillSummary` (`:377`) but have no reader; `allowed-tools` is notably **not enforced** by any tool filter.
- `~/.glrs/skills/` and `~/.glorious/skills/` are never read: `skillRoots` maps ancestors to `.agents/skills` only (`skills.ts:108`) and adds the `.glrs`/`.glorious` spellings for `root` alone (`:109`–`:110`) — even though `~/.glrs/` is where config, commands and extensions all come from. **Small wire-up: add them to the ancestor map.**

---

# 10. Tools and tool plumbing

The wrapper every tool passes through, and the filter layer that decides which the model sees. The tools themselves are extensions — see component 12. `toolkit.ts`, `agent.ts:213`–`:293`.

## Shared plumbing

- Every tool — shipped or third-party — goes through `wrapTool`: one global monotonic event id (so a turn running parent, subagent and MCP tools cannot collide), the gate, a 30,000-character result cap, elapsed-time measurement at the call site, and start/end events whose listener errors are swallowed. `toolkit.ts:23`, `toolkit.ts:63`, `toolkit.ts:78`, `toolkit.ts:95`, `shell.ts:10` — [internal]
- A result is judged failed by pattern (`^ERROR:`, `[interrupted]`, `[timed out`), which is what drives the ✗ mark and the extra reason line. `toolkit.ts:15`, `toolkit.ts:96` — [internal]
- Tool gate: a `tool_call` handler returning `false` makes the tool return `ERROR: an extension blocked <name> for this turn.`; returning a string returns `ERROR: <string>`. A `tool_end` handler returning a string replaces the result the model sees. Installed by both the TUI and `-p` into a module-level slot. `index.ts:1026`, `index.ts:1029`, `index.ts:1039`, `print.ts:217`, `toolkit.ts:59`, `toolkit.ts:83`, `toolkit.ts:97` — [ext API]
- Row detail is taken from the first of `command`, `pattern`, `path`, `task` present in the input, then `urls` (one URL or "N pages") then `files` (one path or "N files"). `toolkit.ts:104` — [internal]
- Result summaries are keyed by tool name — `read` counts lines, `grep` matches, `glob` files, discounting `[truncated at …]` prose; everything else uses its single line, or the last line of many. An extension's tool describes itself through `renderResult` instead. `toolkit.ts:132`, `toolkit.ts:138` — [internal]

## Tool filtering

- Filters are predicates kept and re-run per model call, not a frozen name list, so a tool from an extension that loaded later is still judged by an earlier filter. All filters must agree; an empty list means everything survives. `agent.ts:213`, `agent.ts:222`, `agent.ts:237`, `agent.ts:240`, `agent.ts:293` — [internal]
- Extension tools are rebuilt per model call and handed the current turn's tool-event sink through a mutable slot, which is what lets a tool registered at `session_start` reach the live progress row. `agent.ts:119`, `agent.ts:235`, `index.ts:275`, `index.ts:384`, `print.ts:77` — [ext API]
- `agent.toolNames()` returns what the model would currently see after filters — the answer to `g.tools()`. Calling it builds the whole tool set with a no-op sink. `agent.ts:287`, `index.ts:867`, `print.ts:149` — [ext API]
- Tool name collisions are first-claimed-first-kept, so a `bash.ts` in `.glrs/extensions/` replaces the shipped one rather than racing it, and the shadowing is recorded in the contribution ledger. `extension-api.ts:635` region, `builtins/src/index.ts:11` — [ext API]

## Skill activation tool

- `activate_skill` — loads a named skill's full body wrapped in `<skill_content>` with its directory path; built only from skills the model was told about, and omitted entirely when there are none. It is spread into the tool set first, so an extension registering the same name replaces it. `skills.ts:315`, `agent.ts:232`, `agent.ts:234` — [TUI, -p]


### Not on a live path

- `toolkit.ts:105` — the `"task"` key in `firstDetail` matches no tool on main; the complete registered set is `bash, read, write, edit, grep, glob, configure_extension, ask_user, web_fetch, activate_skill`, none with a `task` input. Residue of a removed delegation tool.

---

# 11. Extension platform

How extensions are found, loaded, and what they can register. Almost everything user-visible in glrs arrives through this. `extension-api.ts`, `extensions.ts`.

## Discovery and planning

- Discovery roots are `extensions/` under every agent directory — `.glrs`, `.glorious`, `.agents` for each ancestor up to `$HOME`, plus `~/.config/agents`. `foo.ts` and `foo/index.ts` are both one extension named `foo`; `.test.ts` files are skipped; symlinked directories count. `extensions.ts:36`, `extensions.ts:42`, `usercommands.ts:11` — [ext API]
- Resolution order: disk first (so the documented first-file-wins rule is untouched by config), then the four bundled extensions, then any absolute path named in `extensions.load`. Names are lowercased and trimmed. `extensions.ts:177`, `extensions.ts:199`, `extensions.ts:211`, `extensions.ts:234` — [config]
- Four bundled extensions with model-facing summaries: `builtins` (`defaultOn: true`), `ask-user`, `worktree`, `web-fetch` (all `defaultOn: false`, requiring `extensions.load` by name or by `@glrs-dev/glrs-ext-*` specifier). `extensions.ts:83`–`:118` — [config]
- Shadowing a bundled extension by putting a file of the same name on disk is supported and silent, except for `builtins`, which emits a note saying the model now has no tools unless yours registers them. `extensions.ts:70`, `extensions.ts:216` — [TUI]
- Resolution failures are diagnostics, not crashes: a `scoped:package` spec says installers are not supported yet, a bare unknown name lists what ships, and a bad absolute path names the file that is missing. `extensions.disable` naming something that would not load anyway produces a note. `extensions.ts:238`, `extensions.ts:244`, `extensions.ts:255`, `extensions.ts:271` — [config]
- The plan is inert — it computes name, origin, source (disk/bundled/config) and directory without running anything, which is what makes `glrs doctor` safe and lets skill roots be derived at startup. `extensions.ts:159`, `extensions.ts:293` — [CLI, TUI]

## Loading

- Each extension is imported and invoked on its own inside a try/catch, so one that throws on import or in its factory costs only itself; a missing `index.ts` is reported as "no index.ts" rather than a raw module-resolution error; a module with no function default export is refused by name. Factories are awaited, so an extension that fetches on the way up has finished registering before the first turn. `extensions.ts:60`, `extensions.ts:297`, `extensions.ts:313`, `extensions.ts:322`, `extensions.ts:326` — [ext API]
- A `token` is appended to the import specifier on reload so the module cache does not hand back the startup copy. `extensions.ts:302`, `index.ts:962` — [ext API]
- In the TUI, loading happens after the screen exists (so failures are visible) and before the first turn (so a registered tool is callable); failures print as `(extension <origin>) <message>` errors and notes as notices. `index.ts:994`, `index.ts:997`, `index.ts:1009` — [TUI]

## Registry and API surface

- 16 registry containers: `tools`, `commands`, `runners`, `cli`, `handlers`, `renderers`, `toolFilters`, `statuses`, `footers`, `activities`, `promptLines`, `keys`, `flags`, `markdown`, `bus`, `contributions`. `extension-api.ts:486`–`:519` — [ext API]
- A per-extension contribution ledger records tools registered, tools shadowed, commands, subcommands, hook count and UI-widget count; `describeContribution` renders it, and it is the only account anyone gets of what a loaded extension did — there is no approval prompt. `extension-api.ts:508`, `extension-api.ts:581`, `index.ts:859` — [ext API]
- `g.inspect()` returns the live command table, skill summaries, and every loaded extension annotated with that summary. `index.ts:854` — [ext API]
- `g.print(content, tone)` treats the tone as a default: a string becomes a notice block in that tone; a `Line[]` gets the tone spread under each span, so spans naming their own tone keep it. `index.ts:841`, `index.ts:846` — [ext API]
- Renderers return glrs's own `Line[]` span structure, never opentui types, so the renderer can be swapped without breaking an extension. `extension-api.ts:24`, `extension-api.ts:29` — [ext API]
- Extensions get `g.z` (zod), `g.exec` (the same shell `!` runs), `g.root`, `g.settings()`, `g.available()`, `g.columns()`, `g.clip()`, `g.hasUI`, `g.mode`. `extension-api.ts:~600`–`:711`, `index.ts:807`, `print.ts:108`, `cli.ts:62` — [ext API]

## Lifecycle events

- 20 events: `session_start`, `session_end`, `input`, `user_bash`, `turn_start`, `turn_end`, `idle`, `message`, `before_request`, `tool_call`, `tool_start`, `tool_end`, `model_select`, `usage`, `reasoning`, `error`, `compact`, `context`, `before_provider_request`, `after_provider_response`. `extension-api.ts:38`–`:59` — [ext API]
- Verdict-carrying hooks: `input` (string rewrites, `false` swallows), `before_request` (string appends to the turn message), `tool_call` (`false`/string refuses), `tool_end` (string replaces the result), `context` (array replaces the message list for that call only). `extension-api.ts:~100`–`:150`, `index.ts:563`, `index.ts:790`, `agent.ts:402` — [ext API]
- The send waits on the `input` hook rather than racing it. `index.ts:563`, `index.ts:568` — [TUI]
- Extension failures inside a hook are rendered as `(extension) …` errors and deliberately do not re-enter the `error` hook, so a throwing handler cannot loop. `index.ts:465`, `index.ts:758` — [ext API]
- All 20 fire in the TUI. `-p` fires 16 — `input`, `user_bash`, `compact` and `model_select` never fire there. The CLI host fires none. `index.ts:402`…`:1060`, `print.ts:83`…`:345`, `cli.ts:110` — [-p, CLI]

## Reload

- `g.reload()` (reached by `/reload`) re-reads config, re-derives extension skill roots, reloads skills and markdown commands, empties the registry in place, reloads every extension with a fresh token, re-applies `tools.disable`, re-registers the merged command table, pushes new skills into the agent, and reports config diagnostics, extension failures, extension notes and skill warnings into the transcript. Only the extension and tool blocks are taken from the re-read config — the model is deliberately not swapped. `index.ts:933`, `index.ts:954`, `index.ts:962`, `index.ts:966`, `index.ts:972`, `builtins/src/index.ts:242` — [TUI]
- The registry object is emptied container-by-container rather than replaced, because `index.ts` and the agent both hold it by reference; the host object is hoisted so a second load can be handed the same host. `extension-api.ts:525`, `index.ts:258`, `index.ts:807` — [internal]


### Not on a live path

- `KeySpec.description` (`extension-api.ts:232`) is required at registration and read by nothing — `/help` prints a hardcoded key table (`builtins/src/index.ts:125`) and `Loaded` has no `keys` field. **Small wire-up: a `keys` field plus a loop in `/help`.**
- `FlagSpec.description` (`extension-api.ts:236`) is likewise never read, and `g.flag` is the one registrar that increments no ledger counter, so `describeContribution` can never mention a flag.

**Live seams with no shipped user.**

Real, dispatched, reachable by a user-authored extension in `.glrs/extensions/` — but nothing shipped registers against them, so on a stock install the dispatcher always takes its empty branch. `rg` across `packages/extensions/` finds zero uses of: `g.flag`, `g.key`, `g.status`, `g.footer`, `g.activity`, `g.markdown`, `g.events`, `g.filterTools`, `g.send`, `g.setInput`, `g.models`, `g.setModel`, `g.abort`, `g.idle`, `g.pending`, `g.shutdown`, `g.systemPrompt`, `g.setSessionName`.
Consequences on a stock install: `index.ts:686` `onKeyBinding` always returns false; the extra-flag loop at `index.ts:1013` always prints `(unknown flag: …)`; `registry.footers` (`index.ts:338`), `registry.activities` (`index.ts:350`), `registry.statuses` (`index.ts:363`) are always empty and `shown()` (`index.ts:422`) is the identity; `extension-api.ts:700` `filterTools` has zero non-test callers even in-repo (`applyToolBans` pushes into `registry.toolFilters` directly); the entire `registry.bus` (`extension-api.ts:726`) has no emitter and no subscriber; `describeContribution`'s `"N ui"` segment (`extension-api.ts:590`) can never print; `print.ts:127` `capture` throws only for a caller that does not exist (ask-user returns early on `!g.hasUI`); and all 21 `needsSession` throw sites in `cli.ts:81`–`:101` are unreachable, since the only registered subcommand's body touches just `g.print` and `g.root`.
`configure_extension` in `-p` is a special case: it registers (`builtins/src/index.ts:90` — `print.ts:112` supplies a real `available()`), but the preamble that tells the model it exists is TUI-only (`index.ts:394` vs `print.ts:81`) and `print.ts:115` returns `"not-allowed"` unconditionally — a model-callable tool that is undiscoverable and cannot succeed.

---

# 12. Bundled extensions

Four ship in the box. Only `builtins` is `defaultOn`; the rest need naming in `extensions.load`.

## 12.1 builtins (`defaultOn: true`)

### The six coding tools

- `bash` — runs `bash -lc <command>` in the project root, 10-minute default kill, stdout capped at 20,000 chars and stderr at 9,000, appending `[exit N]` on failure or when there was no output. `builtins/src/tools.ts:88`, `tools.ts:21`, `shell.ts:11` — [TUI, -p]
- `read` — UTF-8 text with `N|` line-number prefixes, plus the AGENTS.md guidance governing the file's own directory appended. `builtins/src/tools.ts:106`, `tools.ts:122` — [TUI, -p]
- `write` — whole-file write creating parent directories. `builtins/src/tools.ts:126` — [TUI, -p]
- `edit` — multi-file, multi-edit in one call; every edit in every file is resolved in memory first so a failure writes nothing, each file is written to a temp sibling with the original mode and renamed into place (a crash leaves either the old file or the new one), and a non-unique `old_string` is refused with its hit count unless `replace_all`. `builtins/src/tools.ts:139`, `tools.ts:41`, `tools.ts:54`, `tools.ts:66` — [TUI, -p]
- `grep` — ripgrep with filename/line/no-heading, optional case-insensitive, fixed-string, glob and include-ignored; always excludes `.git`; caps results and reports `[truncated at N matches]`. `builtins/src/tools.ts:178`, `tools.ts:23`, `tools.ts:26` — [TUI, -p]
- `glob` — ripgrep `--files --sortr modified` in a directory, refusing a non-directory outright, capped with the same truncation report. `builtins/src/tools.ts:203` — [TUI, -p]
- Path handling: relative paths resolve against the project root, absolute paths are taken as given, and nothing is refused — `bash` sits unconfined beside the other five. `builtins/src/tools.ts:83` — [internal]

### Shipped slash commands

All print into the transcript as aligned, clipped tables rather than opening a panel. `builtins/src/index.ts:32`, `:53`, `:67`

- `/help` — every command with its description, plus a **hardcoded** key table (Esc, Ctrl+C, `!`, `@`) built from literals, not from the registry. `builtins/src/index.ts:113`, `:125` — [TUI]
- `/skills` — every skill with its `/skill:` command, description and an origin tag (bundled / project / personal / other), or `you only` for a skill the model cannot see. `builtins/src/index.ts:141`, `:67` — [TUI]
- `/extensions` — loaded extensions with origin tag and a summary of what each contributed, then what ships but is not on; `/extensions enable|disable <name>` writes the choice through `g.setExtension` with a distinct message per outcome. `builtins/src/index.ts:170` — [TUI]
- `/clear` — drops the conversation the model replays, keeping the transcript; reports `busy` or `nothing to clear`. `builtins/src/index.ts:229` — [TUI]
- `/reload` — re-reads extensions, skills and commands, then reports the new counts. `builtins/src/index.ts:242` — [TUI]
- `/compact [instruction]` — forces a compaction with an optional custom instruction; only "nothing worth compacting yet" and "cannot compact while a turn is running" are said here, since success and failure are reported where the compaction happens. `builtins/src/index.ts:253` — [TUI]
- `/session` — id, context tokens and percent, lifetime input/output/cached tokens with the cache hit rate, dollar cost over N calls, event count and the session file path. `builtins/src/index.ts:265` — [TUI]
- `/wt` (worktree extension) — `new`/`create`, `list`/`ls [--all]`, `doctor`; removal is deliberately CLI-only. Created worktrees are recorded as session entries. `worktree/src/index.ts:124` — [TUI, gated `extensions.load: ["worktree"]`]

### `configure_extension`

- `configure_extension` (builtins) — registered only when at least one shipped extension is undecided; records a yes/no into config through `g.setExtension` and returns a distinct message for written/already/unknown/not-allowed/failed. `builtins/src/index.ts:90`, `:101` — [TUI]

## 12.2 ask-user

- `ask_user` (ask-user extension) — 1–20 questions each with 1–10 options, drawn as a `Line[]` widget that takes over the composer slot via `g.ui.capture`: ↑↓ to move, Enter to choose, Tab to add a free-text note, Esc to dismiss. Answers are returned to the model as prose Q/A pairs; dismissal returns an explicit instruction not to ask again. The tool registers only when `g.hasUI`, so a headless run never gets a question nobody can answer. It also contributes its own prompt line telling the model when to use it. `ask-user/src/index.ts:141`, `:104`, `:112`, `:139`, `:146`, `:180`, `ui/screen.ts:227` — [TUI, gated `extensions.load: ["ask-user"]`]

## 12.3 web-fetch

- `web_fetch` (web-fetch extension) — up to 10 URLs, 4 at a time; a manual-redirect probe reports cross-host redirects instead of following them and fails on HTTP ≥ 400; renders with headless Chrome when one of five known paths (or `Bun.which`) finds it, falling back to plain fetch; extracts main content with `uvx trafilatura --markdown`, falling back to an HTML-stripping regex chain; caches results for 15 minutes; rejects non-http(s) schemes. Chrome and uvx run detached with SIGTERM/SIGKILL deadlines. `web-fetch/src/index.ts:11`, `:28`, `:106`, `:145`, `:176`, `:182`, `:209`, `:232` — [TUI, -p, gated `extensions.load: ["web-fetch"]`]

## 12.4 worktree

- `glrs wt new|create [description] [--from <ref>]` — creates a worktree under a per-repo root with an auto-derived slug/branch name, branching from `origin/<default-branch>` with `--no-track` so the new branch reports no upstream; a colliding branch is refused rather than force-deleted; prints the path first so `cd $(glrs wt new x)` works. `worktree/src/index.ts:59`, `:76`, `worktree.ts:76`, `worktree.ts:87`, `worktree.ts:199`, `worktree.ts:212`, `worktree.ts:221` — [CLI]
- A `.glrs/hooks/wt_new` (or `.glorious/`) hook runs on creation when present. `worktree.ts:170`, `worktree.ts:175` — [CLI]
- `wt list [--all]`, `wt doctor`, `wt rm <branch> [--force]`, `wt clean [--dry-run|--yes]` — doctor correlates each worktree against every session's cwd (through `listSessions`, and through realpath so macOS `/var` → `/private/var` does not make the main checkout look removable) and reports whether it is safe to remove and why not. `clean` refuses to act without `--yes`. Removal reports an unmerged-branch failure instead of swallowing it. `worktree/src/index.ts:86`–`:117`, `worktree.ts:48`, `worktree.ts:260`, `worktree.ts:327`, `worktree.ts:346` — [CLI]
- `GLORIOUS_DIR` is honoured for the worktree root. `worktree.ts:66`, `worktree.ts:132` — [config]
- A per-turn prompt contribution lists the worktrees this session created (from session entries, so a resumed session still knows) and says nothing at all when none were made. `worktree/src/index.ts:38`, `:155` — [TUI]


### Not on a live path

- `repoName` (`worktree.ts:60`) — zero references; `worktree.ts:205`/`:235` re-derive it inline.

---

# 13. Terminal UI

The paint loop and everything drawn in it. `render.ts`, `ui/screen.ts`, `ui/chrome.ts`, `ui/picker.ts`, `composer.ts`.

## Paint loop

- A single 100 ms interval repaints for as long as the session is open and is cleared on teardown; nothing animates, and every paint routes through the screen's dedupe so an unchanged frame reaches the renderer not at all. `index.ts:72`, `index.ts:1071`, `index.ts:1090` — [TUI]
- Each repaint first flushes streamed deltas, so a burst of provider tokens costs one paint; the draft block appends when the delta kind matches and swaps when text↔reasoning changes. `index.ts:318`, `index.ts:510`, `chat.ts:107` — [TUI]
- A tool that finishes inside 250 ms never shows a progress row. `index.ts:73`, `index.ts:322`, `index.ts:324`, `render.ts:438` — [TUI]
- Every third-party render call — tool call/result renderers, footers, activity rows, status segments, markdown transforms — runs inside a swallow-and-continue wrapper, so a throwing extension loses only its contribution for that frame instead of taking down a loop running ten times a second. `index.ts:294`, `index.ts:313`, `index.ts:327`, `index.ts:338`, `index.ts:352`, `index.ts:424` — [ext API]
- Resize re-lays every scrollback block, the composer and the completion window. `ui/screen.ts:571` region (`onResize`), `ui/screen.ts:592` — [TUI]

## Status and activity

- Status line: provider/model, the reasoning variant in parentheses when set, current context tokens, percent of the window used (only when the context size is known), and any string each extension status widget returns; non-string returns are dropped. `index.ts:356`, `index.ts:361`, `index.ts:363`, `render.ts:481` — [TUI]
- Activity row: while busy or compacting, each registered activity renderer is asked in turn and the first that returns lines wins, else the built-in row (`<phase> <elapsed> · Esc interrupt · N queued`). Blanked entirely when idle. `index.ts:341`, `index.ts:350`, `index.ts:355`, `render.ts:514`, `render.ts:521` — [TUI]

## Transcript rendering

- Tool calls render as one line — mark, name in a 7-character column, the call detail joined with the result summary, duration pushed to the right margin — with a second line only for a failure's reason. `render.ts:233`, `render.ts:288` — [TUI]
- A run of consecutive tool calls (whatever happened between two things the model said) closes with a single footer line carrying call count, total elapsed and failures, drawn only for more than one call. The same fold drives live rendering and replay. `render.ts:311`, `render.ts:319`, `render.ts:339`, `index.ts:472`, `index.ts:764`, `print.ts:203` — [TUI, -p]
- A streamed answer is sealed in place: when the durable assistant event lands while text is still drafting, the draft block is replaced rather than the text being printed twice. The event is recorded either way. `index.ts:483`, `index.ts:488`, `ui/screen.ts:619`, `ui/screen.ts:628` — [TUI]
- Extension markdown transforms are display-only — they compose left to right over assistant text before painting and never touch the session file or the model. `index.ts:422`, `index.ts:429`, `index.ts:476` — [ext API]
- `"(no response)"` prints only when a turn produced neither assistant text nor a tool call. `index.ts:467`, `index.ts:526`, `chat.ts:221` — [TUI]
- Errors are described rather than stringified: nested `error` fields, response bodies and an AggregateError's first cause are unwrapped, anything unrecognised is serialised (better than `[object Object]`), and known-noisy runtime/provider messages are rewritten into plain wording. `render.ts:32`, `render.ts:40`, `render.ts:71` — [TUI, -p]
- A compaction prints the brief itself with a header saying what it cost, rather than describing it. `render.ts:196` — [TUI]

## Composer and keys

- Enter submits (follow-up), Shift+Enter inserts a newline, Alt+Enter steers, Alt+Up un-queues — the Alt chords are taken before the completion menu and before the textarea's own name-and-shift bindings, which would otherwise turn Alt+Enter into a plain submit. `ui/screen.ts:88`, `ui/screen.ts:475`, `ui/screen.ts:481`, `composer.ts:1`, `composer.ts:7`, `composer.ts:12` — [TUI]
- Ctrl+C: clears a non-empty composer; on an empty one it interrupts and arms a quit timer, and a second press inside the window quits. `ui/screen.ts:429` (`onCtrlC`), `ui/screen.ts:537` — [TUI]
- Esc closes an open completion menu and leaves the line alone, remembering the text it was dismissed on so the menu stays shut until you type again; with no menu open it interrupts. `ui/screen.ts:505`, `ui/screen.ts:545` — [TUI]
- History recall: arrows reach for history only at the first/last line of the draft (shell behaviour), Ctrl+P/Ctrl+N are unconditional; moving inside the draft keeps your place in history. `ui/screen.ts:527`, `ui/screen.ts:531`, `ui/screen.ts:534`, `composer.ts:24`, `composer.ts:27` — [TUI]
- Completion window is at most 10 rows and never more than the terminal can show, scrolled to keep the selection inside and clamped so the last page is full. `ui/screen.ts:155`, `ui/screen.ts:158`, `composer.ts:34` — [TUI]
- Extension keybindings run before the composer sees the key: a binding matching name+ctrl+shift consumes the keystroke, runs asynchronously and repaints; a throw reports `key <name> failed: …`. `index.ts:686`, `index.ts:694`, `ui/screen.ts:465` — [ext API, gated on an extension calling `g.key()`]
- `g.ui.capture()` hands the composer area to an extension: it renders `Line[]` at the current width and receives every key as glrs's own `{key, ctrl, shift, text}` shape, never an opentui type. This is what `ask_user` is built on. `ui/screen.ts:218`, `ui/screen.ts:227`, `ui/screen.ts:451` — [ext API]


### Not on a live path

- `transcript` (`render.ts:419`) — exported, no non-test caller anywhere in `packages/`.
- `ui/chrome.ts:19`–`:21` (`edgeHex`, `dimHex`, `accentHex`) and the second element of every `tones` tuple (`chrome.ts:7`–`:15`, ANSI SGR codes) — `screen.ts:15` imports only `createChrome, fillHex, panelHex`, and index `1` of the tone tuples is read nowhere. Leftover from an ANSI renderer.
- `render.ts:339` — `toolGroupFooter` is guarded twice: `advanceToolRun` gates on `run.calls > 0` and the function returns `[]` for `calls < 2`. Redundant, harmless.

---

# 14. Public API surface (SDK and extension types)

The declared public surface: an SDK entry, a type barrel, and the `Glrs` type every bundled
extension imports. **None of the runtime half is reachable**, and the type half has drifted from
the object it describes. This component is where glrs's stated API and its real API disagree.

### Not on a live path

- **`packages/glrs-coding-agent/src/sdk.ts` (44 lines)** — declares `createCodingAgent` (`sdk.ts:41`) and re-exports `createAgentCore` / `jsonSessionRepository` / `createProviderRegistry` (`sdk.ts:17`–`:25`). Zero importers: it is the declared entry of `packages/glrs-coding-agent/package.json:12`, but that manifest is `"private": true` and the published root package declares no `main`/`module`/`exports` and no `workspaces`, so nothing in-repo or on npm can resolve it. Not reached by any test. **Near-miss wire-up: one `exports` map in the root manifest turns this into the public SDK.** It still ships, because root `files` includes `packages/glrs-coding-agent/src`.
- **`packages/glrs-coding-agent/src/public-extension-api.ts` (35 lines)** — a pure type re-export barrel plus `export type Extension`. Its only importer is dead `sdk.ts:7`/`:26`. Zero runtime cost; dead surface area.
- **`packages/glrs-core/src/index.ts` (163 lines) — live as a type declaration, dead as a module.** It is in every host's *static* closure, but `tsconfig.json:12` sets `verbatimModuleSyntax: true` and every importer outside dead `sdk.ts` uses `import type` (`provider-registry/src/index.ts:1`, all four extensions' line 1, `extension-api.ts:3`). The only value import is `sdk.ts:17`–`:20`. So `export * from "./events"` (`:7`) and `"./session"` (`:8`) never fire — live code reaches those modules by deep import instead (`index.ts:4`, `index.ts:6`–`:13`).
- `createAgentCore` (`glrs-core/src/index.ts:157`) — only caller is `glrs-core/src/index.test.ts:15`. Test-only ⇒ dead.
- `Extension` / `ExtensionFactory` (`glrs-core/src/index.ts:142`, `:163`) — each referenced only by the other's alias line.
- `UiHost.print`, `.ask`, `.status`, `.footer`, `.activity` (`glrs-core/src/index.ts:54`–`:61`) have no implementation anywhere; the only `ui` object ever constructed is `{capture, setInput}` at `extension-api.ts:695`. All are optional, so `g.ui.status?.(…)` typechecks and is `undefined` at runtime. `ask` is residue of the removed ask/select/confirm widget.
- Conversely `ui.setInput` exists in all three hosts (`index.ts:837`, `print.ts:148`, `cli.ts:82`) and is absent from the declared `UiHost`.
- **The type shipped extensions are written against has drifted.** All four import `Glrs` from `glrs-core/src` (→ `ExtensionContext`, `glrs-core/src/index.ts:91`–`:141`); set-differenced against the real `Glrs` (`extension-api.ts:280`–`:441`), these 18 members exist at runtime and are missing from the declared type: `abort activity events filterTools flag footer idle key markdown model models pending setModel setSessionName shutdown status systemPrompt tools`. Every one has a live dispatcher. Same drift in `Tone` (5 declared vs 7 supported — `render.ts:4` adds `prompt` and `success`) and `Span` (missing `italic`/`underline`, which `chrome.ts:55` honours). **`public-extension-api.ts:5` already re-exports the correct type; the hand-maintained copy is the problem.**

---

# 15. Build, packaging and release

What ships, what enforces the boundaries, and how a version reaches npm. Root manifests, `bunfig.toml`, `biome.json`, `tsconfig.json`, `scripts/`, `.github/workflows/`, `infra/`, docs-site build.

- Published package is bin-only: root `package.json` declares `bin.glrs`/`bin.glorious` and no `main`, `module` or `exports`. `package.json:37`, `package.json:13`–`:31` — [build]
- `files` ships `bin`, `packages/glrs-coding-agent/package.json`, `packages/**/src` (minus `*.test.ts`), and `docs`. `package.json:13`–`:31` — [build]
- Not a bun workspace: root `package.json` has no `workspaces` key and `bun.lock` has one workspace entry named `agentj`. Consequently every per-package `exports` map is inert, every cross-package import is a deep relative path, and per-package `dependencies` are never installed — `@vscode/ripgrep` resolves only because it sits in the root dependencies. `package.json` (no `workspaces`), `bun.lock:4`, `agent.ts:3`, `builtins/src/tools.ts:8`, `package.json:81` — [build]
- `bunfig.toml` denies all dependency lifecycle scripts (`[install.scripts] allowList = []`), so `@vscode/ripgrep` cannot run its binary-download postinstall; both call sites already degrade — `mentions.ts:171` falls back to a hand-walk, `builtins/src/tools.ts:30` returns an `ERROR:` string. `bunfig.toml:5` — [build]
- Boundary check: `glrs-core` may not depend on the coding agent or provider-registry, `provider-registry` may not depend on the coding agent, and `packages/extensions` may not depend on either — enforced by raw substring search over file text, exiting 1 with every violation listed. Run in `check`, CI and release. `scripts/check-boundaries.ts:14`, `:42`, `:45`, `package.json:51`, `ci.yml:30`, `release.yml:32` — [build]
- Biome formats and lints everything except `.changeset`, `docs-site` and `infra`, at 100 columns with double quotes and always-semicolons, on the recommended preset with `correctness/noUnusedVariables` and `style/noNonNullAssertion` disabled. `biome.json:4`, `:6`, `:16` — [build]
- Typecheck covers `packages/**/*.ts` and `docs/**/*.ts` (of which there are zero files), so `scripts/`, `eval/`, `docs-site/` and `infra/` are never typechecked in CI; `docs-site` and `infra` are outside biome too. `tsconfig.json:19`, `packages/tsconfig.json:1`, `package.json:46`, `ci.yml:26` — [build]
- Release: changesets in prerelease mode on the `next` tag; `.npmrc` scopes `@glrs-dev` to npmjs with `${NPM_CONFIG_TOKEN}`; `release.yml` gates the `latest` retag on `.changeset/pre.json` existing, and that retag step rewrites `~/.npmrc` with a literal token instead of reusing the committed one. `.changeset/config.json:3`, `.changeset/pre.json:1`, `.npmrc:1`, `release.yml:16`, `release.yml:71`, `release.yml:74`, `scripts/release-publish.sh:33` — [build]
- Docs site builds with TypeDoc against exactly two entry points (`src/public-extension-api.ts`, `src/sdk.ts`) and deploys to a GCS bucket; it is its own install root with its own lockfile and tsconfig, and its `test`/`lint` scripts are `echo` stubs, so docs-site TypeScript first breaks at deploy time. One docs-site test file is nonetheless picked up by the root `bun test` recursion. `docs-site/typedoc.json:3`, `docs-site/package.json:8`, `docs-deploy.yml:47`, `package.json:45` — [build]
- `docs-site/public/install.sh` ships as a curl-to-bash installer: offers to install bun, hard-requires git, treats `gh` as optional, installs `@glrs-dev/glrs@next`, and verifies `glrs` landed on PATH with a `bun pm bin -g` hint on failure. `docs-site/public/install.sh:28`, `:50`, `:59`, `:68`, `:70` — [build]


### Not on a live path

- **`packages/glrs-coding-agent/scripts/sync-docs.ts` (7 lines)** — invoked only by `packages/glrs-coding-agent/package.json:16`'s `prepack`, on a private package that is never packed; the release publishes the root package, which has no `prepack`, and root `files` does not include `scripts/`. Consequence: the packaged-docs branch of `docsPath()` (`prompt.ts:19`) is never satisfied, and the fallback branch (`<pkg-root>/docs/published`, shipped via root `files`) is the live one.
- **`packages/glrs-coding-agent/bin/glorious`** — a working shim, but root `files` ships `bin/` (repo root) and `packages/glrs-coding-agent/{package.json,src}` — not `packages/glrs-coding-agent/bin`. It works only from a git checkout. Worse, `packages/glrs-coding-agent/package.json:8` declares `"bin": {"glrs": "bin/glrs"}`, a path that does not exist in that directory.
- `docs-site/scripts/dev.ts:8`–`:9` watches `packages/glorious-core/src` and `packages/glorious-coding-agent/src/sdk.ts`; neither directory exists since `57d7f1c`, and `dev.ts:60`'s `.filter(existsSync)` drops both silently — the docs dev server has quietly stopped watching source. **Wire-up cost: two strings.**
- `.gitignore:4` ignores `packages/glorious-coding-agent/docs/`; the path sync-docs would create is `packages/glrs-coding-agent/docs` and is not ignored. `.gitignore:39` ignores `eval/**/results.json` while four such files are tracked.
- `.changeset/pre.json:5` still lists `@glrs-dev/glorious` in `initialVersions`.
- `.serena/project.yml:2` names the project `glorious`; it configures a third-party MCP server and no glrs source reads it.
---

---

# Cross-cutting conventions

Patterns that hold across components rather than living in one.

## Rename compatibility (`glorious` → `glrs`)

Every old-name path in the agent is a *read* that succeeds if the user has the old name; only the session store is deliberately asymmetric.

- Config: `.glorious/config*.json` and `~/.config/glorious/config.json` read alongside the `.glrs` spellings, project before personal regardless of spelling. `config.ts:85`, `config.ts:89` — [config]
- Env: every setting is `GLRS_<X>` then `GLORIOUS_<X>`. `config.ts:98` — [config]
- Resources: `<root>/.glorious/skills`, `<dir>/.glorious` for commands and extensions, `.glorious` exempted from the mention dot-directory skip, `GLORIOUS_DIR` and `.glorious/hooks/wt_new` for worktrees. `skills.ts:110`, `usercommands.ts:28`, `mentions.ts:146`, `worktree.ts:66`, `worktree.ts:175` — [config]
- Sessions and prompt history: read from both stores, written only to `glrs`, so resuming an old session migrates it one at a time. `session.ts:27`, `session.ts:108`, `session.ts:145` — [internal]
- Binary names: both `glrs` and `glorious` map to the same entry. `package.json:37` — [CLI]


---

# Uncertain

- **`glrs update` pins `@next` permanently** (`index.ts:119`). Whether that is intended — there is no path from `update` back to a stable tag — is not determinable from source.
- **`sdk.ts` / `public-extension-api.ts` intent.** The `exports` maps (`packages/glrs-coding-agent/package.json:12`) and TypeDoc entry points (`docs-site/typedoc.json:3`) suggest they are meant to be the public API; the survey establishes only that no code path reaches them today.
- **`variant` namespaces for 12 providers.** Confirmed by opening the SDKs: openai/azure honour it, anthropic does not. The other twelve were reasoned from the same mechanism, not verified per-SDK.
- **`infra/gcp` OIDC binding.** `infra/gcp/index.ts:213`/`:223` assert repository `iceglober/glrs`, while root `package.json:9` says the repo is `iceglober/glorious`. The two committed values disagree; the actual GitHub repo name is not determinable from committed source, and nothing in CI runs `pulumi`.
- **`bun install --frozen-lockfile` with a root-name mismatch** (`bun.lock` root is `agentj`, `package.json:2` is `@glrs-dev/glrs`). Whether bun rejects this is not established.
- **`docs-site/scripts/build.ts`** was not read (assigned elsewhere), so whether `public/install.sh` is copied into `dist/` — and therefore actually served — is not confirmed from source.
- **Blocking stdin under `-p`.** `Bun.stdin.text()` (`index.ts:135`) has no bound; with stdin redirected from a pipe that never closes, the run waits indefinitely. Nothing in the file caps that.
- **`setToolGate` is a module-level global** (`toolkit.ts:59`), not per-session state; both `index.ts:1026` and `print.ts:217` write the same slot. Irrelevant with one host per process, unverified if two ever ran in one.
- **`saveSession` is fire-and-forget** (`index.ts:417`), so two writes can overlap; nothing serialises them. No corruption was observed or reproduced — the hazard is structural.
- **`onContext`'s second argument** is documented as `step` (`agent.ts:126`, `extension-api.ts:115`) but is actually the stream-resend counter, and the hook fires once per attempt rather than once per step; on a healthy turn an extension always sees 1 and never sees a mid-turn message list.


---

# Index — everything not on a live path

The 45 items above, gathered. Each links to the component that owns it.

| Component | Items |
|---|---|
| 1. CLI entry | `index.ts:176`; `index.ts:194`; comments describing a non-existent `--help` |
| 2. Hosts | `cli.ts:46` |
| 3. Configuration | `config.ts:205` |
| 4. Models and providers | `createProviderRegistry`; `compatibleNote`; `ProviderSpec.note` (never read); `providers.amazon-bedrock.api`; `providers.azure.api` — azure branch sends no `baseURL`; `region`/`project`/`location` dropped for other providers; `ModelOption.apiKey`; `variant`; `providers.ts:139`; `providers.ts:143`; `models.ts:232` |
| 5. Sessions | session forking (`forkSession`) |
| 7. Turn loop | `QUEUE_MODES`; prompt-cache directives are OpenAI-only; `agent.ts:237` |
| 8. Prompt and context | `mentions.ts:212`; `loadAgentRules` |
| 9. Skills and commands | skill `allowed-tools` parsed, never enforced; `~/.glrs/skills` never read |
| 10. Tools | `toolkit.ts:105` |
| 11. Extension platform | `KeySpec.description` (never read); `FlagSpec.description` |
| 12. Bundled extensions | `repoName` |
| 13. Terminal UI | `transcript`; `ui/chrome.ts:19`; `render.ts:339` |
| 14. Public API surface | `sdk.ts`; `public-extension-api.ts`; `glrs-core/src/index.ts` — type-only, module never executes; `createAgentCore`; `Extension`; `UiHost.print`; `ui.setInput` implemented but undeclared; `Glrs` type drift — 18 members missing |
| 15. Build and release | `scripts/sync-docs.ts`; `packages/glrs-coding-agent/bin/glorious`; docs-site dev watcher points at pre-rename paths; `.gitignore:4`; `.changeset/pre.json:5`; `.serena/project.yml:2` |

Plus the whole of **14. Public API surface**, and the live-but-unused extension seams listed in **11. Extension platform**.
