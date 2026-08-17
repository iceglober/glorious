# @glrs-dev/glorious

## 1.0.0-next.22

### Minor Changes

- 0747b43: The core registers no slash commands and no tools of its own.

  `/help`, `/clear`, `/skills` and `/extensions` were built in, and two of them could not have been written as extensions even in principle: the API exposed neither the skills catalogue nor the extension registry. A core that keeps capabilities its own extension API cannot reach is not extensible, it is just small.

  All of them — plus a new `/reload` — now ship as `bundled/builtins.ts`, written against exactly the API a third party gets. With `web-fetch` already bundled, glorious ships nothing the core privileges: shadow any of them by name from `.glorious/extensions/`, or delete them and write your own. Nothing in the core depends on them existing.

  The API gains what they needed: `g.inspect()` returns `{ commands, sequences, skills, extensions }` — every listing is a view over it — `g.clear()` drops the conversation the model replays, `g.reload()` re-reads from disk, and `g.print()` now takes `Line[]` as well as a string so an extension can draw styled output into the transcript.

  They print into the transcript instead of opening a panel over it. A listing you can scroll back to, copy out of, and read beside the work that prompted it beats one that takes the screen and has to be dismissed — and it costs the API no windowing surface to support. `ui/overlays.ts` and the sheet-sizing machinery behind it are gone with them: 261 lines of UI and 90 of tests for geometry nothing draws any more.

  Name collisions no longer have a privileged side. First registration wins, extensions register before skills and command files, and a duplicate never reaches the help listing or the autocomplete.

## 1.0.0-next.21

### Minor Changes

- 55d1f1a: Read only glorious's own directories and the vendor-neutral Agent Skills layout.

  Discovery walked `.claude` at every level of the tree, plus `~/.claude/skills`, `~/.claude/plugins/cache` (scanned recursively) and `~/.config/amp/skills`. Another tool's entire command and skill surface therefore arrived as glorious slash commands — on this machine that meant `/wt` and `/verify` appearing in `/help` — and every one of those skills' names and descriptions was paid for in the per-turn preamble, on every turn, whether or not any of them were used.

  Now: `.glorious/` and `.agents/` up the directory tree, plus `~/.agents/skills/` and `~/.config/agents/`. The neutral standard is kept, so a skill installed under `.agents/skills/` still works everywhere it did. Symlink a skill from another tool into `.agents/skills/` if you want it in glorious.

  Removing the plugins cache also removed the only root that needed a recursive scan, so `discover()` no longer carries a special case keyed on a root's index in the list — arithmetic that would have silently applied nested scanning to whichever root happened to land second-to-last.

## 1.0.0-next.20

### Major Changes

- a7e4853: Tear glorious down to a small core with a real extension API. Non-test source drops from ~6,500 lines to ~4,900 — 4,200 lines deleted against 1,700 added, most of the additions being the extension API itself — and everything removed is now expressible as a TypeScript file you write.

  - **Extensions.** A `.ts` file in `.glorious/extensions/` that default-exports a function taking the glorious API can register tools the model calls, slash commands that run your code, lifecycle hooks (`session_start`, `input`, `turn_start`/`turn_end`, `tool_start`/`tool_end`), status-line segments, footer rows, and custom rendering for its own tool rows. Bun runs `.ts` directly, so there is no build step, and everything arrives on the API object — including zod, as `g.z`, because an extension that had to resolve `zod` itself would work in a project and fail from your home directory. Renderers return glorious's own `Line[]` spans, never opentui types, so the renderer can be replaced without breaking a single extension. `/extensions` lists what loaded, what it registered and where it came from; one that fails to load says so loudly and takes nothing else with it. See `docs/extensions.md`.
  - **It extends itself.** `docs/` ships in the package, and the system prompt names its absolute path, lists what each file covers, and tells the model that a capability glorious lacks is usually an extension it should write and then verify with `glorious -p`. Asking for a new tool is now a request glorious fulfils rather than declines. It is pointed at the docs and not at `v2/`: the documented API is the contract, and handing it the implementation invites it to reach past that contract.
  - **`glorious -p "<prompt>"`.** One turn, headless, no alternate screen: assistant text on stdout, the tool trail on stderr. It is how the agent tests changes to itself, how anything scripts glorious, and — invoked through `bash` — how one glorious spawns another with every step of the child visible.
  - **Sequences.** The markdown `$name` concept keeps working under its real name: run a shell command, optionally clear the conversation, optionally feed the output into a prompt — in that order. Files move to `.glorious/sequences/`; `.glorious/extensions/*.md` still loads for one release and says where to move.
  - **Removed: subagents.** `eval/delegation` measured the same answers for ~1.8× the tokens and ~2.6× the wall clock. Its one real benefit, keeping the child's reading out of the parent's context, survives as `-p` through `bash`.
  - **Removed: MCP.** 7–9% of the context window for schemas you mostly do not call, paid every turn. Extensions register the same tools with no subprocess, no JSON-RPC, no approval fingerprints, and no cost until installed.
  - **Removed: plan mode.** One mode, build, with every tool always. A plan that needs to survive belongs in a file.
  - **Removed: the model picker, the Keychain, and the layered config.** Config is `GLORIOUS_MODEL`/`GLORIOUS_VARIANT`, then `.glorious/config.json`, then `~/.config/glorious/config.json` — read-only, no schema, unknown keys ignored. All fourteen providers still work; what you lose is switching model without restarting. One models.dev request survives as metadata for the status line's context percentage, silent when it fails.
  - **Removed: session encryption.** Sessions are plain JSON. No Keychain prompt anywhere in the product, and a driven or headless run needs nothing disabled first.
  - **Removed: animation.** The sine-wave field behind the status line and the five-cell block that marched across every running tool row are gone; the paint tick now costs nothing when no number has changed. What they were wrapped around stays: streaming text and reasoning, what the model is doing and for how long, live tool rows with elapsed times, and the context/token status line.
  - **The system prompt is ~40 lines**, down from 300. What was cut comes back as an `AGENTS.md` line, a skill, or an extension's `g.prompt()` — all of which cost nothing until read, unlike the one block paid for on every turn. The cache discipline that keeps volatile content out of it is unchanged and still guarded by a test.
  - **`web_fetch` is now a bundled extension**, enabled by default. It is the proof the API is real.

## 1.0.0-next.19

### Patch Changes

- fd7667c: Stop turns dying with `Item with id 'rs_…' not found`.

  The OpenAI provider defaults `store` to true, which makes it replay earlier assistant text and reasoning as `{type: "item_reference", id: "…"}` — asking the service to look up content it stored server-side — instead of sending that content. Whenever a lookup missed, the whole turn failed. glorious sends its complete history on every request, so it gains nothing from server-side state; `store: false` now sends the content inline, and makes the provider request `reasoning.encrypted_content` so reasoning stays replayable.

  Measured on the wire across a multi-turn session: item references went from growing every turn (2, 2, 3, …) to **zero**, with encrypted reasoning carried inline instead. Prompt caching is unaffected. Sessions recorded before this fix already carry the encrypted content, so they resume without any migration.

## 1.0.0-next.18

### Minor Changes

- 30a400a: Add `$` extensions — named project scripts that run without calling the model.

  A slash command always ends in a turn; `!` never does but has to be typed out in full. There was
  no way for a project to name a deterministic action and reach it quickly. Neither the Agent
  Skills spec nor Claude Code's slash commands cover this: both can run shell, but only ever to
  build a prompt, so "run this, change local state, send nothing to the model" had nowhere to live.

  An extension is a markdown file in `.glorious/extensions/<name>.md`, invoked by typing `$` and
  completing the name. Frontmatter holds the deterministic part, the body is an optional prompt:

  ```markdown
  ---
  description: Reset to a clean main
  run: |
    git checkout main
    git pull --ff-only
  clear: true
  ---

  The working tree was reset. Anything you knew about the previous branch is stale.
  ```

  `run` always executes, with arguments passed as real positional parameters so `$fresh main` gives
  the script `$1` — nothing is interpolated into the command text. With a body, a turn is sent once
  the shell succeeds, carrying the script's stdout as fenced evidence; `run: git diff` plus "review
  this" is a whole workflow in one file. Without a body no turn is produced at all, which is the
  part nothing else offers. `clear` drops the conversation for a script that moves the ground the
  model was standing on. A non-zero exit shows the output and stops: nothing sent, nothing cleared.

  Extensions are user-invoked only — the model cannot decide to reset your working tree. They are
  discovered like commands (project directories shadow personal ones), listed in `/help`, and
  reloaded by `/skills`. Autocomplete is now sigil-aware, so `/` and `$` each complete their own
  namespace, and `$` is withheld in shell mode where `$VAR` is a real variable.

- 8b09362: Say what the model is doing while you wait for it.

  The wave now carries a phase and how long it has been in it — `waiting 2.3s`, `thinking 11.9s`, `writing 0.4s` — driven by the model call itself rather than a timer. Tool activity is left to the rows above it, which already name the tool and its elapsed time.

  This closes the gap streaming did not. Streaming works, but a median assistant message here is 205 characters, which arrives in under half a second; the wait _before_ any text appears was measured at 2.3 seconds, and a high-effort turn can reason for twelve. That stretch used to be an animated line with no information in it.

  Also fixes a long-standing overrun: on a narrow terminal the interrupt hint was clipped to the full width and then given a two-space separator, making the row two columns wider than the screen.

### Patch Changes

- 30a400a: Stop a failed turn from shredding the screen.

  `streamText`'s default error handler is `console.error`, which writes a raw stack trace straight to the terminal — landing at whatever cursor position the TUI happened to be at, interleaved with the transcript and the composer. A failed model call now renders as a single error line, as it did before streaming.

  Two supporting fixes: the promises carrying a turn's final text, messages and steps are subscribed before the stream is iterated, so a mid-stream failure cannot strand them as unhandled rejections (three per failure, each printed to stderr); and an error arriving as a stream part is now thrown rather than silently ending the turn as if it had produced nothing. A process-level guard routes any remaining stray runtime output into the transcript instead of over the screen.

## 1.0.0-next.17

### Minor Changes

- 01ff336: Stream the model's answer instead of waiting for it, and show reasoning while it happens.

  - **Text appears as it is generated.** Model calls used `generateText`, so a turn was prompt up, a long silence, then the whole reply at once. On a measured prose turn the first text now lands 2.3s in and the turn finishes at 5.5s — 3.3 seconds of a 5.5 second turn that previously showed nothing but the progress animation.
  - **Reasoning is visible.** On turns that reason — plan mode asks for high effort — the thinking streams in muted text, then collapses to a single `thought for 2s` line once the answer begins. The full text is kept in the session so a resumed session replays the same line.
  - Usage, cost, context accounting and prompt caching are unchanged: they ride the same per-call hook as before, and caching is request-shaped. Subagents still use `generateText`, since their output is a returned summary rather than something painted live.
  - Interrupting mid-answer keeps what was already written on screen, with `(interrupted)` beneath it.

## 1.0.0-next.16

### Minor Changes

- 6b717f2: Arrow keys edit the draft, and a subagent's tool calls stay out of the session.

  - **↑/↓ move within what you are typing** and only reach for history at the first and last line, the way a shell does. `Ctrl+P`/`Ctrl+N` remain unconditional history, so recalling a long prompt never costs you fast cycling. Lines are logical, so a soft-wrapped paragraph counts as one.
  - **A subagent's tool calls no longer stream into the transcript.** Each carries the id of the `run_subagent` row that spawned it, so the session shows one summary row per subagent — its task, tool count and elapsed time — instead of two agents' work interleaved.
  - **`Ctrl+B` opens a running subagent's stream** in the composer, with `Tab` to cycle when several are live and `Esc` to close. Subagents stay reachable for the rest of the turn after they finish. With none running the key does nothing and the hint stays hidden.

## 1.0.0-next.15

### Patch Changes

- 0f283f5: Make every skill a slash command, and say so when a command does not exist.

  - **A skill is reachable under its own name.** Commands were granted only to skills declaring a `trigger:` in their frontmatter, so a skill that dropped the field lost its command with no warning — which is what happened when graphify shipped 0.9.41 without one, taking `/graphify` with it. Every skill now has a command named after it; `trigger:` only renames it.
  - **An unknown slash command is reported.** Any `/word` was treated as a command, which cleared the composer and then matched nothing, so the message vanished and no turn ran. A command that does not exist now says so instead of swallowing the input.

## 1.0.0-next.14

### Patch Changes

- 891a273: Use the environment credential the provider picker already reports as available.

  A provider can be reached under several environment variable names — azure answers to `AZURE_FOUNDRY_API_KEY`, `AZURE_API_KEY` and `AZURE_OPENAI_API_KEY` — but each SDK falls back to exactly one. The picker reported a provider as connected on any of them, while the session was started with none of them, so a shell holding only `AZURE_OPENAI_API_KEY` failed every first message with "Azure OpenAI API key is missing" and only recovered after connecting the provider by hand in `/models`. The key is now resolved from the same list the picker checks, so "environment credentials available" means the session can actually start.

## 1.0.0-next.13

### Patch Changes

- d0df31e: Fix two faults in user-defined slash commands, both hit the first time one was run for real.

  - **The expansion was echoed as the user's own message.** A skill trigger expands to tens of thousands of characters, so running one filled the transcript with the skill file instead of the single line that was typed. The transcript now shows the command as typed; the model still receives the full expansion.
  - **A triggered skill did not run.** It arrived as a bare `<skill_content>` block, which reads as reference material rather than as something to carry out — the agent replied asking what to work on and fell through to the repository's own rules. It now arrives framed as an instruction to run the skill.
  - Arguments appended to a body with no placeholder are marked as arguments, so a bare `.` trailing 32kB of instructions is no longer indistinguishable from a stray character.

## 1.0.0-next.12

### Minor Changes

- ec67b6b: Add agent modes, plan approval, and user-defined slash commands.

  - **Modes.** A mode is a capability preset — which tools the agent may reach for, and how hard it is asked to think — layered on whatever model is active, so `/models` stays orthogonal. `build` restricts nothing; `plan` is read-only and asks for high reasoning effort where the model offers it. `/mode` opens a picker and Tab cycles. The active mode is a coloured label under the composer rather than a line in the status footer.
  - **Read-only is enforced, not requested.** In plan mode the restricted tools are absent from the toolset rather than forbidden in the prompt. `bash` is withheld because `ls` and `rm -rf` are indistinguishable before running them. MCP tools opt in per server via a `readOnly` list; an undeclared tool is withheld rather than guessed at.
  - **Plan approval.** A plan-mode turn ends by presenting its plan for approval, in the composer. Approve and implement from a fresh context, approve and keep the conversation, or reply with feedback and have it revised. Approving switches to build mode and runs the plan as its own turn. Clearing resets what the model sees, not what you see: the transcript keeps every line, and a resumed session inherits the same trimmed context.
  - **`/clear`** drops the conversation the model replays while keeping the transcript. It refuses mid-turn, when the running request would otherwise overwrite the clear as it lands.
  - **User-defined slash commands.** Markdown files in `.glorious/commands`, `.agents/commands` or `.claude/commands` — walking up from the project, then the home directory — become slash commands, as do skills that declare a `trigger:` in their frontmatter. Both expand `$ARGUMENTS` and `$1`–`$9`, and a body with no placeholder still receives the arguments. Built-in commands win name collisions.
  - **Questions and menus render in the composer** instead of as panels over the transcript. A question is the input area asking rather than waiting, so it takes the composer's place; help, skills, MCP and the model pickers do the same, and gain room now that they spend no space on a border.

## 1.0.0-next.11

### Minor Changes

- ca252d8: Allow provider-specific model price multipliers and show accumulated usage cost.

### Patch Changes

- ca252d8: Quiet the TUI status footer to a single muted row with model and context usage.
- ca252d8: Wrap long question choices in the TUI and pause plan revisions until the user sends feedback.

## 1.0.0-next.10

### Minor Changes

- Add layered global, project, and local configuration; persist non-secret model and provider settings; and require approval before project MCP servers run. Add `glorious doctor`, MCP reload diagnostics, and provider connection through the macOS Keychain with environment fallback.

## 1.0.0-next.9

### Patch Changes

- c25eff1: The agent can now see how much context it is holding, and its prompt is shorter.

  - Each turn reports the conversation's size against a 200,000 token budget,
    overridable with `GLORIOUS_CONTEXT_BUDGET`. Measured on this model, the same
    task takes 3.7× longer at 163k of context than at 25k.
  - The worked examples in the system prompt are a third of their former size and
    now show delegating rather than reading everything in the main thread. The
    whole prompt drops from about 2,650 to 1,950 tokens.
  - `<grounding>` no longer treats a subagent's findings as unverified, which had
    required re-reading whatever was delegated and undone the point of delegating.

## 1.0.0-next.8

### Patch Changes

- 0a04722: Stop shipping test files in the published package. `files` listed the whole
  `v2` directory, so 13 `.test.ts` files went out with every release. The tarball
  drops from 40 files to 27.

## 1.0.0-next.7

### Patch Changes

- d7d543c: `web_fetch` now degrades as documented when its optional helpers are missing.

  Bun throws when a binary is absent, and the spawn was unguarded, so a machine
  without `uv` got `Executable not found in $PATH: "uvx"` instead of the plain
  tag-strip fallback the docs promise. A browser that fails to start now falls
  through to a plain fetch the same way.

## 1.0.0-next.6

### Minor Changes

- 46162cf: Multi-file editing, safer subagents, and a documented set of decisions.

  - `edit` now changes any number of files in one call. Every replacement in every
    file is resolved before anything is written, so a failure leaves the whole tree
    untouched, and each file is swapped into place by rename rather than rewritten.
    Measured against per-file batching, work spanning four files uses 51% fewer
    input tokens.
  - Subagents are safe to run in parallel. Tool events from concurrent subagents no
    longer collide, so durations in the transcript are correct; a subagent can no
    longer reach the user, and one that runs out of steps says so instead of
    returning nothing.
  - A failed edit now reports how many times the text occurred, and says when a
    miss was against text an earlier edit in the same call produced.
  - README and glrs.dev rewritten against the code. The site had documented an
    `edit` strategy setting and a context limit that do not exist.

## 1.0.0-next.5

### Patch Changes

- 24aa2c2: Add `glorious --version` and `glorious update`. The update command installs the latest published `next` release explicitly, avoiding stale global package pins.

## 1.0.0-next.4

### Minor Changes

- Add `/models` for switching providers and models during a session, with models.dev catalog metadata, provider-qualified model identities, fuzzy search, scrolling, and reasoning-variant selection.

  Refresh the status footer with token totals and model context usage, and improve the composer waterline and full-width transcript message backgrounds.

## 1.0.0-next.3

### Major Changes

- 4933158: Replace the implementation with a ground-up rewrite in `v2/`, and delete `core/`.

  Same product — a barebones chat TUI over an agent with core tools — in 1,165 lines
  across seven files instead of 4,382. The TUI is unchanged to look at: the `❯` user
  band, `●` assistant blocks, live tool sweep, VU meter, queue and interrupt ladder,
  and scrollback replay on exit all behave as before.

  What changed under it:

  - **Tools** are now `bash`, `read`, `write`, `edit`, `grep`, `glob`, all defined
    against one `Bun.spawn` helper. A killed or failed tool now freezes into the
    transcript as a red `✗` instead of a green `✓`.
  - **Assistant text now prints before the tools it announces.** Previously a
    preamble was emitted at step end, so it landed underneath the tool rows it was
    describing.
  - **Gone:** the LLM port/adapter split, the sandbox and workspace port layers,
    prompt profiles and their template engine, the output spill store, context
    compaction, and the three interchangeable edit modes.
  - **Breaking:** there is no CLI argument parsing. `glorious --help` and
    `glorious --version` no longer exist; running `glorious` opens a chat session.
    The generated command-line reference is dropped from the docs with it.

## 0.1.0-next.2

### Minor Changes

- da707bb: Tear glorious down to the studs: a basic chat TUI over an agent with bash/read/edit/search tools and an Azure-only LLM. Removed: slash commands, plan/build modes, MCP, the permission system, model selection and the config system/TUI/CLI, session persistence and resume, subagents, background jobs, todos, skills, web tools, secrets/keyring, metrics, the updater, evals, and the bench harness. The CLI is now just `glorious` (plus `--help`/`--version`); Azure credentials and the model come from environment variables.

## 0.1.0-next.1

### Minor Changes

- 4f727de: The model picker now gates on provider connection and guides setup. The provider column shows each provider's status (✓ connected · cloud ✓ · connect ↵), and choosing an unconnected provider routes into its connect flow — an API-key form for key providers, or a cloud-auth setup form for Bedrock and Vertex — then resumes the picker at that provider's models once it connects. The cloud-auth form detects whether AWS/GCP credentials are already present, collects the non-secret params (Bedrock region; Vertex project/location), and can run the vendor login CLI (`aws sso login`, `gcloud auth application-default login`) by suspending the TUI, handing the terminal to the login, and resuming when it returns. Vertex and Bedrock also now resolve their required setting (Vertex location, Bedrock region) from config → env → a sensible default (Vertex `global`, Bedrock `us-east-1`), so a provider connected purely via detected credentials no longer hard-errors at first use when the location/region was never set. Vertex defaults to the `global` location because the newest Gemini models are served there and not from regional endpoints; a "model not found in region" error now says so and points at `global`. Vertex's ADC token fetch is routed through a fetch transporter so it works under Bun (it otherwise failed with "fetchImpl is not a function").

  When a chat turn dies on a cloud provider's stale credentials, glorious now recognizes the opaque vendor error (e.g. Google's `invalid_rapt` blob), shows a one-line fix instead, and — when the CLI is available — runs the login for you and retries the message once, rather than making you copy a command out of the error.

- 4f727de: The config TUI folds provider management into the model picker. The standalone "Providers" section is gone; the picker's provider column now lists only providers you can actually use (a connected key, or detected cloud credentials) plus the current selection, and `^n` opens a "Connect a provider" catalog — the full list with status where you connect / disconnect / set up cloud auth. Connecting a provider there returns you to the catalog; a connected provider then appears in the picker.

  Selecting a cloud provider now verifies its live session before opening its models: Vertex fetches an access token (catching a stale ADC / `invalid_rapt` session) and, if it's stale, drops you into the setup form to re-run the login before continuing — so you can't pick a model behind a broken session. Bedrock uses creds-present as the bar, with the turn-time auto-reauth as the backstop.

- 4f727de: Remove the ANSI live-region renderer. The full-screen OpenTUI surface is now the only chat renderer — the `tui.renderer` config option and the `GLORIOUS_TUI` env override are gone (a legacy `tui.renderer: ansi` in an existing config is ignored, not an error). This also fixes the "Ctrl+C again to exit" hint not appearing: it lived only in the ANSI screen, and is now implemented in the OpenTUI screen where the first Ctrl+C on an empty prompt shows the hint (and still interrupts a running turn), a second within a few seconds exits, and any other key dismisses it.

### Patch Changes

- 4f727de: Give model responses their own visual anchor in the transcript. User turns lead with `❯` and tool rows with `✓`, but the assistant's prose had no marker and read as loose text between the activity rows. Responses now lead with a `●` accent marker on their first line, so the model's answer stands out as a distinct block.
- 4f727de: The first Ctrl+C on an empty prompt now shows a "Ctrl+C again to exit" hint above the status bar (and still interrupts a running turn). A second Ctrl+C within a few seconds exits; otherwise the hint times out and any other keypress dismisses it — so an accidental Ctrl+C no longer risks a silent exit or leaves you guessing.
- 4f727de: Add model-family prompt addenda, matched against the complete `provider/model` ref, and use one to curb Gemini's over-eager background jobs. Gemini models (any provider — `vertex/gemini-*`, `google/gemini-*`) were calling `run_background_job` for plain questions; the addendum keeps the agent free to start a job on its own but makes the good reasons concrete — the user explicitly asking for background/parallel work, or work that genuinely must run detached (a CI run, a code review, a deploy) — so a question gets answered directly instead. Addenda are appended inside the version-hashed prompt body, so they don't collide across model families in the prompt cache.
- 4f727de: Remove the completion-grounding gate. It cross-checked a turn's final response against its tool trajectory and, on a mismatch, forced a corrective retry — but its "claimed active deferred work" heuristic matched a model merely _describing_ the background-job capability (an answer mentioning "run background jobs, like waiting for CI or code reviews" read as a claim of active monitoring), then forced `run_background_job`, starting a pointless job. Since a runtime `requiredFirstTool` can't be overridden by the prompt, this fired regardless of guidance. The gate is gone; turns now generate directly. Completion reports still parse and render as before — only the retry/correction machinery is removed.
- 4f727de: Surface the model's intermediate prose. A turn used to show only the final text; if the model wrote something (e.g. an explanation) in an earlier step alongside its tool calls and then a shorter closing message, that earlier text was dropped — which is why a response could refer to "my previous message" you never saw. Each step's assistant text now streams into the transcript as it lands (the final text isn't duplicated). Turns where the model only speaks at the end are unchanged.
- 4f727de: Refresh the chat TUI's live animations and transcript hierarchy. The running-tool indicator is now a side-to-side sweep — a short bar that grows from one edge, slides across as it empties, then does the same from the other side — instead of a single cell growing and shrinking in place, and it animates on the fast frame (~90ms) for snappier motion. Background-job rows now show a spinning quadrant dial (◴◷◶◵) instead of the same bar, also on the fast frame. In the transcript, a background job's "started" line is indented and muted so it groups with the tool activity under the turn, leaving the assistant's prose flush-left as the primary content; a job's finish line gets a blank line above it to separate its result from the activity above.

## 0.1.0-next.0

### Minor Changes

- 62f6524: `glorious config` now opens a full-screen, keyboard-driven config TUI — Models, the Trust access-control list, Providers, and MCP servers — instead of the drill-down menu (which remains a fallback). The full-screen OpenTUI chat renderer is also now the default; opt back to the lighter live-region renderer with `tui.renderer: ansi` (or `GLORIOUS_TUI=ansi` for one session).
- 1aa4be0: Initial release of glorious — a terminal coding agent, and the flagship of the @glrs-dev ecosystem. (Formerly published as `@glrs-dev/aj`.)
- 62f6524: Replace the permission model with a default-deny access-control list. `permissions` is now `{ uncaged, rules }`: a map of idiomatic tool-call patterns to `allow`/`ask`/`deny`, where anything unmatched is denied. Patterns are the tool-call forms themselves — `bash(pnpm *)`, `edit`, `web`, and canonical MCP ids like `mcp_linear_get_issue` (or `mcp_linear_*`; the `mcp__` form is accepted as an alias) — with deny beating allow beating ask. A single `uncaged` flag opens everything. Repository reads/searches remain ungated. The shipped starter policy keeps out-of-the-box behavior equivalent to the old edit=allow / web=allow / bash=ask / mcp=ask defaults, fully overridable per project/machine.
- 62f6524: Add a clean plan→build handoff, per-role model variants, and layered config:

  - **Plan → build handoff.** `/build` now approves the plan and starts the builder on a fresh model context seeded with just the task and the approved plan (not the planner's transcript), then tells it to verify and correct the plan as it goes. Iterate on the plan in plan mode, then `/build` to implement.
  - **Per-role model variant.** Choose the reasoning effort (none/minimal/low/medium/high/xhigh/max) for the plan and build tiers in the config TUI; it's sent to the model at generation time. An unset tier uses the model profile's default.
  - **Layered config with provenance.** Config resolves across global → project → local layers; the TUI and CLI can target any layer (`--scope`, or the scope selector) and show which layer each value comes from.
  - Bare `/config` opens the interactive TUI in-chat, and edits apply to the running session on close.
