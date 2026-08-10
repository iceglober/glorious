# @glrs-dev/glorious

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
