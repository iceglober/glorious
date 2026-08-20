# @glrs-dev/glrs

## 1.0.0-next.55

### Major Changes

- c46dcd7: The extension API is declared once, so an extension author sees the same surface a maintainer does.

  There were two descriptions of one thing: the object `extension-api.ts` builds, and a hand-maintained copy in `glrs-core` that every extension imported. They had drifted. The copy carried 26 members; the object carried 44. `model`, `tools`, `status`, `footer`, `key`, `flag`, `abort`, `activity`, `events`, `filterTools`, `idle`, `markdown`, `models`, `pending`, `setModel`, `setSessionName`, `shutdown` and `systemPrompt` all worked at runtime and were invisible to anyone writing an extension against the type.

  The copy existed for a reason: `packages/extensions` may not import the coding agent, so the type could not live where it was implemented. So the declaration moved the other way — into `glrs-core`, where extensions already reach it — and the agent now _implements_ that type rather than declaring its own. An implementation that falls behind can no longer compile.

  `Tone` and `Span` had drifted the same way and travelled with it, along with the event payload types, so the whole contract is in one place.

  **`UiHost` is gone.** A second, optional-everything description of the same surface, referenced by nothing. It declared `print`, `ask`, `status`, `footer` and `activity` — none of which any host implements, `ask` being residue of a removed widget — and omitted `setInput`, which all three do. Because every member was optional, `g.ui.status?.(…)` typechecked and was `undefined` at runtime.

  **`/help` reads what was registered.** `KeySpec.description` and `FlagSpec.description` were required at registration and printed nowhere: help carried a hardcoded table, and a flag could not even be mentioned. `g.inspect()` now returns the bound keys and flags, and help renders them under glrs's own bindings.

- 91719f9: No default model, no default provider, and every provider is asked in its own words.

  **There is no default.** `model` fell back to `azure/gpt-5.6-luna`, and a model id naming no provider meant azure. So the most likely provider was the one nobody chose — and it was the single branch that dropped `providers.azure.api`, meaning a gateway or private resource silently went to the public endpoint. The guess and the misconfiguration compounded. Both are gone: nothing configured is an error naming the three ways to set one, and `glrs doctor` reports it as a state rather than dying on it, listing the providers that ship.

  **Azure gets its base URL**, like every other provider. `createAzure` was called without `baseURL` while `amazon-bedrock` three lines below passed it.

  **`providers.<id>.api` survives for bedrock and vertex.** It parsed, validated, merged, and then vanished before the model was built.

  **`variant` reaches the provider that will answer it.** The whole options object was nested under the `openai` namespace whatever the provider was. The openai SDK also serves azure, so those two worked and the other fourteen received a key they do not read — `{"model":"anthropic/…","variant":"high"}` parsed, passed `doctor`, and did nothing at all.

  Reasoning effort is not one setting with one spelling, so it is now translated per provider, with the shapes read out of the installed SDKs rather than assumed:

  | provider                         | what is sent                                                  |
  | -------------------------------- | ------------------------------------------------------------- |
  | openai, azure, OpenAI-compatible | `reasoningEffort`                                             |
  | anthropic                        | `thinking: { type: "enabled", budgetTokens }`                 |
  | google                           | `thinkingConfig: { thinkingBudget, includeThoughts }`         |
  | amazon-bedrock                   | `reasoningConfig: { type, budgetTokens, maxReasoningEffort }` |

  Vertex follows the model rather than the host, so an Anthropic model served through vertex is asked the Anthropic way.

  **A provider's `note` reaches `doctor`.** ADC for vertex and the credential chain for bedrock were written on the spec and read by nobody, so `doctor` said a credential was missing without saying how to supply it.

  `compatibleNote` existed three times — once exported and unreferenced, twice inline. It is one function now.

### Minor Changes

- ea1bc4a: The published package has an entry point, and the manifests stop claiming things that were not true.

  **`sdk.ts` can be imported.** It declares `createCodingAgent`, `createAgentCore`, `jsonSessionRepository` and `createProviderRegistry`, TypeDoc generates the docs site from it, and it shipped inside every tarball — but the published package declared no `main`, `module` or `exports`, and the manifest naming it as an entry is `private: true`. Nothing could resolve it. The root package now exports it, and `./extension-api` alongside it.

  **Claims removed rather than repaired**, because each was for machinery that does not run:

  - `packages/glrs-coding-agent/package.json` declared `bin.glrs` pointing at `bin/glrs` — a path that does not exist in that directory. The shim is at the repo root.
  - Its `prepack` ran `sync-docs.ts` on a package that is never packed; the release publishes the root package, which has no `prepack`, and root `files` excludes `scripts/`. Both are gone, and `docsPath()` loses the branch that script existed to fill — it could not be satisfied, so the fallback was always the live path.
  - Its `exports` and `files` cannot be resolved by anything: there are no workspaces, so no package name resolves within the repo.

  **`bun.lock` called the project `agentj`**, three renames ago. `bun install --frozen-lockfile` was verified to still work afterwards.

  **CI typechecks `scripts/` and `eval/` now.** Both were outside `include` and both are clean. `docs/**/*.ts` came out because it matches nothing. Eval fixtures are excluded — they are deliberately broken, being the input an eval runs against.

  **The docs dev server watches source again.** It had watched `packages/glorious-core` and `packages/glorious-coding-agent` since the rename, and a `.filter(existsSync)` swallowed both, so it had quietly stopped rebuilding on source changes.

- 9d5fc14: `glrs --help` exists, and a flag's value is no longer whatever token sat beside it.

  argv was read by index arithmetic inside `main()`, and every bug it had came from one root. `--model -p hi` set the model to `"-p"` and ran headless anyway. `--resume --model x` looked for a session called `--model`. A trailing `--model` was dropped in silence and started an ordinary session. `--Foo` disappeared without even the `(unknown flag:)` line, because the scan was `/^--([a-z][a-z0-9-]*)$/u` and never matched a capital. And `-p` was matched wherever it appeared, so `glrs wt -p hi` ran a headless turn and threw the subcommand away.

  cmd-ts owns glrs's own surface now. Unknown flags and missing values are rejected by construction; the two it does not catch — a value that is really the next flag, and a model id naming no provider — are expressed as a cmd-ts type, so `--model` refuses `-p` and refuses `gpt-5` with a sentence saying why.

  **cmd-ts cannot own the whole tree, and does not.** A subcommand an extension added is not known until extensions load, and glrs deliberately does not load them for a bare `glrs`, a `-p` run or `glrs doctor`. So the first bare word is classified before parsing, and only a word glrs does not claim reaches the extension host. Whichever of `-p` and a bare word comes first now wins, which is what makes `glrs wt -p hi` the worktree subcommand and `glrs -p what failed` a prompt rather than a subcommand called `failed`.

  `--help` is the one route that loads extensions, because help that omitted `glrs wt` would be help that lies — the specs are read from what each extension registered rather than written down twice. `--version` and `--help` also stopped requiring that they be the only argument.

  Errors arrive as one sentence. cmd-ts reports through a coloured multi-line block meant for a terminal; the offending fragment and the reason are lifted out of it, so a parse failure reads like everything else glrs writes to stderr.

- b4e11c9: A provider setting either reaches the model or says why it did not.

  Every provider block accepts `api`, `region`, `project` and `location`, and each provider consumes only some of them. The rest were parsed, validated, merged across config files, and then dropped without a word — `{"providers":{"anthropic":{"region":"us-east-1"}}}` looked exactly like a setting that worked.

  Which settings a provider reads is now declared in one place, and two things follow from it. A key its provider does not read becomes a diagnostic naming the ones it does. And the test suite walks that table rather than checking cases someone remembered, so every key it lists is proved to survive the trip into the model options — a provider added later is covered by construction rather than by someone thinking to add a test.

  This is the answer to shaping config from the AI SDK's own provider types. Importing sixteen provider packages for their settings types would tie the config schema to their release cadence, and those types describe what each client accepts rather than what glrs passes it — which is where the bugs were. The property that matters is that the mapping is total, and that is what is now checked.

- 67dd5a4: Prompt caching works on every provider, to the same standard.

  Caching was OpenAI-shaped throughout: a `promptCacheKey` and nothing else. OpenAI and Google cache a prompt prefix without being asked, so it worked for them — and on Anthropic and Bedrock, which cache only what is explicitly marked, it did nothing at all. Every turn re-read the whole conversation at full price on the providers where that costs the most.

  The two are different seams and are handled separately. `providerOptions` carries what a provider reads about the call; a cache breakpoint has to be written into the messages. Anthropic gets `cacheControl: { type: "ephemeral", ttl: "1h" }`, Bedrock gets `cachePoint`, and a Claude model served through Vertex is marked the Anthropic way because the mark follows the model rather than the host.

  The mark goes on the second-to-last message: everything up to and including it is cached, and it is the newest point that will still be present next turn. The breakpoint therefore advances every turn, which is the point — these providers match on prefix, so a longer prefix beginning with the cached one hits it and extends it rather than starting over. A conversation with nothing stable yet is left unmarked and costs nothing.

  Options a message already carried are preserved rather than replaced.

- 52a812f: `/fork` copies this session to a new id, so you can branch and come back.

  `forkSession` was written, complete and correct — it slices a session's events at a point, mints a fresh id, recomputes the context count and saves. It was reachable only through a repository object whose single consumer was the SDK entry nothing can import, so it had never run outside its own file and had no test.

  `/fork` calls it. `/fork 12` cuts at the twelfth event, `/fork` alone copies the lot, and either way it prints the `glrs --resume <id>` that opens the copy. The original is untouched.

  Nothing about this needed a new API member. `g.session()` already names the session and an extension may reach `glrs-core`, so the command is written with exactly the surface a third-party extension has — which is the point: a first-party command that needed a private door would mean the public one was incomplete.

  `Tone` and `Span` are declared once now, which is what forced this into the open: the renderer paints seven tones and the type extensions import named five, so `/fork` could not report success in the success tone. `italic` and `underline` were honoured by the renderer and missing from the type in the same way.

- c589c34: `allowed-tools` restricts what a skill can use, `~/.glrs/skills` is read, and frontmatter nobody could read now reaches something.

  **`allowed-tools` was a control that controlled nothing.** It was parsed, carried into the summary, and enforced by no filter — a skill declaring it needed only `read` and `grep` could call `bash`. It now holds the turn that activated it to that list, in the TUI and under `-p` alike. The turn is the boundary because activation is a turn-scoped act: the model asked for the skill in order to do something now. `activate_skill` is always kept, so a narrow list cannot trap the model inside the skill it just loaded.

  Wiring it exposed a parser bug worth naming: the list was split on whitespace alone, so the ordinary `allowed-tools: read, grep` produced `["read,", "grep"]`. A tool named `read,` matches nothing. Harmless while the field was enforced by nobody; it would have silently withheld the very tool the skill asked for.

  **`~/.glrs/skills` was never read.** `.glrs` and `.glorious` were searched at the project root only, while the ancestor walk looked for `.agents/skills` alone — so the one directory that holds your config, commands and extensions was the one place a skill could not live. All three agent directories are now searched at every level, still deduped.

  **`license` and `metadata` never left the parser**, and `compatibility` reached the summary with no reader. All three are on `SkillSummary` now. A field a skill author can set and nothing can read is a field that does not exist.

  `SkillSummary` itself was declared twice — once in `glrs-core` and once in `skills.ts` — which is how the two came to disagree about which fields exist. One declaration now, the same fix the extension API got.

- a9ce4c0: The rest of the code that was not on a live path is either wired up or gone.

  **Three were wired up, because each was a missing connection rather than a mistake.**

  `forgetListings` emptied the `@`-completion file cache and nothing could call it — the cache had no invalidation hook anywhere. `/reload` is the user saying the tree changed, so it drops the listing there.

  Machine-wide rules were read from four of amp's locations and none of glrs's own, so an administrator could install rules for amp on a machine and had no way to install them for glrs. `/etc/glrs/AGENTS.md`, the platform equivalents, and `~/.config/glrs/AGENTS.md` are read now, after amp's and therefore nearer.

  `QueueMode`, `QUEUE_MODES` and `isQueueMode` were declared twice — once in the coding agent and once privately in provider-registry, which validates the setting. Neither package may import the other, which is the same reason the extension API had a duplicate, and the same fix: one declaration in `glrs-core`.

  **The rest were removed**: `repoName`, which both call sites re-derived inline; the `task` key in `firstDetail`, matching no registered tool since a delegation tool was taken out; the `amazon-bedrock` and `google-vertex` entries of the provider factory map, which `createModel` returns before ever consulting; a `?? ""` and a `?? "load"` that no input could reach; three fields destructured from `probe()` and never read; and `packages/glrs-coding-agent/bin/glorious`, whose manifest entry went with the packaging fixes and which the published `files` never shipped.

  **Five items stopped being dead without being touched.** Exporting the SDK made `createAgentCore`, `jsonSessionRepository`, `createProviderRegistry`, `Extension` and `glrs-core`'s own module body reachable, since `sdk.ts` value-exports them and is now the package entry. `ModelOption.apiKey` is in the same position: no config file sets it — credentials stay environment-only, deliberately, because a config file is a thing people commit — but a caller building an option through the SDK can, and that caller exists now.

- 3d1b1f4: A resumed transcript is drawn by the extensions you have loaded.

  Replay ran hundreds of lines before the extensions did, so `renderTool` returned undefined and the markdown transform chain was the identity. However many renderers an extension registered, history got glrs's own default rendering — and because the transcript is printed once into scrollback rather than re-rendered on later paints, "before the extensions" meant "wrong for the rest of the session".

  The replay now happens after they load and still before the startup notices, so the transcript reads first and whatever went wrong at startup reads under it.

  No assertion about output could catch this: both orders produce a transcript, and the wrong one produces a perfectly valid default. The order is the bug, so the order is what is pinned — and the guard is checked against the old arrangement to confirm it fails on it.

  The tone table also stops carrying ANSI escape codes nobody read. Each entry was a `[hex, SGR]` pair and only the hex was ever used; the codes were residue of a renderer that no longer exists, alongside three exported colours with no reader.

## 1.0.0-next.54

### Patch Changes

- 1296cb6: An extension's skills directory is looked in once, however many extensions share it.

  A disk extension's directory is wherever its file sits, so `aws-exec.ts` and `todos.ts` side by side in `~/.config/agents/extensions/` describe one `skills/` directory between them. `skillRootsFor` derived a root per extension and handed discovery that same path twice. Discovery walks every root it is given, so each skill under a shared directory was found once per extension beside it — and then collided with itself: `two skills are named "x"`, naming the same file on both sides.

  Nothing surfaced today only because that directory has no `skills/` in it yet. It would have appeared the first time anyone put a skill next to an extension, and the warning it produces points at one file while claiming there are two, which is a bad half-hour for whoever reads it.

  The roots are deduplicated now. The test asserts the plan really does contain several extensions resolving to one directory before it checks that the root arrives once — without that, a plan that stopped sharing directories would leave the assertion passing while testing nothing.

## 1.0.0-next.53

### Minor Changes

- 51a7980: An extension can add subcommands to the `glrs` executable.

  `g.cli("wt", { description, run })` makes `glrs wt …` work. Until now an extension could give the agent a tool and give you a slash command, but everything it offered lived inside a session — so a capability that is really a piece of tooling, like managing git worktrees, had to be a separate program with its own name on your PATH.

  **A subcommand runs outside any session.** No model, no transcript, no screen, no credentials, nothing to wait for. `g.print` writes straight to stdout undecorated so the output pipes; `g.root`, `g.exec`, `g.settings` and `g.z` work as usual; `g.send`, `g.model`, `g.ui.capture` and the rest throw and say why rather than returning something plausible. That refusal is filled in one place, so adding a member to the API cannot quietly leave this path with a hole in it — the type demands it be answered, and "this needs a session" is a better answer than a lie.

  Extensions are loaded to find out whether a word is a subcommand, so this is reached only after glrs's own words are ruled out: a bare `glrs`, `glrs -p …`, `glrs doctor`, `glrs update` and `glrs --version` never pay for it, and none of them can be taken by an extension. The first extension to claim a subcommand keeps it, the same rule tools follow, so `glrs wt` does not depend on load order.

  `glrs <unknown>` now lists what extensions have added rather than only what is built in — the extensions that would have claimed the word have just been loaded and asked, so naming them costs nothing.

- 7950ad6: An extension can ship a skill, and a prompt contribution can say something about the session.

  Two seams, both of which existed in a shape that was almost enough.

  **`g.prompt` accepts a function.** It pushed a string, and the per-turn preamble was rebuilt every turn — but from strings fixed at registration, so a contribution could describe the extension and nothing else. Passing a function has it asked fresh each turn, which is what lets one say what the _session_ is doing. Returning `""` says nothing, so a line that is only sometimes relevant costs nothing when it is not, and one that throws loses its own line rather than the turn. Both hosts resolve contributions through the same function; this is the third thing the TUI and `-p` each have to do identically and the previous two had drifted.

  **An extension can carry a `skills/` directory** beside its source, laid out exactly like `.glrs/skills/`. The obstacle was ordering — skills are read at startup, extensions do not load until hundreds of lines later — and the fix is that `resolveExtensions` is inert: it stats directories and executes nothing, so it can run first and say which extensions _would_ load. Their skill directories join the roots without a single extension having run, at startup rather than after a reload. Extension roots are appended last, so a skill in your project or your home directory still wins a contested name.

  Two defects fixed on the way, both found while mapping this:

  - **`~/.agents/skills` was searched twice.** It is listed explicitly and reached again by the ancestor walk whenever your project sits under `$HOME`, so every personal skill was found twice and warned that it collided with itself — naming the same path on both sides of the sentence. The test suite could not see it: every test passes a scratch home outside the tree, which is exactly what stops the ancestor walk reaching it.
  - **`originOf` still tested for `/v2/bundled/`**, a directory that stopped existing when this became a monorepo. Nothing had matched it in months, so `/skills` and `/extensions` tagged everything glrs ships as `other`.

- 4a192cc: `glrs wt` creates and audits git worktrees, and knows which ones you are still working in.

  Worktree management arrives as a first-party extension: `glrs wt` from a terminal, `/wt` inside a session, and a skill that teaches the agent when to reach for one. It ships off, like every first-party extension since — `{"extensions":{"load":["worktree"]}}` turns it on.

  **`glrs wt doctor` is why this is an extension rather than a wrapper.** glrs records the directory every session ran in, so it can tell you which worktrees somebody is still working in before you clean anything up — something a standalone tool cannot know:

  ```
  fix-the-login-redirect
      /Users/…/.glrs/worktrees/repo/fix-the-login-redirect
      active 9m ago · a session was working here recently · 2 uncommitted changes
  ```

  A session older than a week is reported but does not block: that is history, not occupancy.

  `wt new "fix the login bug"` makes the branch **and** the directory `fix-the-login-bug`, from a freshly fetched `origin/<default>`. A project can put an executable at `.glrs/hooks/wt_new` to do whatever a fresh worktree needs — install dependencies, copy a `.env` across; it is handed the worktree directory as its argument and in `WORKTREE_DIR`/`REPO_NAME`, and a hook that fails warns rather than costing you the worktree.

  Four things it deliberately does differently from the tool it replaces:

  - **git is the source of truth**, not a registry file. A registry drifts, self-rewrites on every read, and once it has any entry it stops falling back to git — so a worktree made with plain `git worktree add` becomes invisible. `git worktree list --porcelain` cannot go stale.
  - **A name already taken is refused.** The old behaviour was `git branch -D` on a collision, which throws away whatever was on that branch.
  - **No upstream is set.** Branching from a remote-tracking start point sets one automatically, so a fresh branch reported "up to date with origin/main" however far it had diverged; `--no-track` is what actually leaves it unset, and `git push -u` sets the right one.
  - **Unpushed commits are measured against the branch's own remote**, not against the base — a branch fully pushed to its own remote used to count as unpushed and be skipped forever.

  Removal stays yours. The skill tells the agent to run `doctor` and report, and to hand you the command rather than run it: deleting a worktree deletes a directory, and deciding what is safe needs judgement about work the agent may not be able to see.

  Two bugs the tests caught while building this, both of the same shape: git reports real paths, and on macOS `/var` is a symlink to `/private/var`. A computed path and a git-reported one for the same directory compared unequal, so the main checkout was offered up for removal as a worktree on a protected branch, and a session's recorded directory failed to match the worktree it was in — silent, and in the direction that deletes work.

## 1.0.0-next.52

### Minor Changes

- 343b6f1: glrs can tell you about a capability it does not have, and remember your answer.

  `web_fetch` and `ask_user` ship in the box and wait to be asked for. That is a better default than loading everything, but it has an obvious failure: an agent asked to read a web page has no tool for it, and no way to know one exists. So the extensions that ship but have never been decided about are named to the model each turn, with a line saying what each is for.

  **Nothing about this costs a prompt-cache miss.** The list rides the per-turn `<extensions>` block, which is rebuilt every turn anyway; the system prompt stays byte-identical, and messages already in history keep their cached prefix. `<extensions>` is already a preamble tag, so the block is stripped from a replayed transcript without a new one being added. There is a source-scan test pinning that, because moving one call in `index.ts` would break it and no assertion about output would notice — both paths reach the model.

  Once you answer, it stops being offered. When every shipped extension has been decided, the section disappears entirely: an agent that keeps offering something you already declined is worse than one that never offered. The three states need no store of their own — named in `extensions.load` is a yes, named in `extensions.disable` is a no, in neither is a question nobody has answered.

  Recording the answer needs permission, because config is yours to edit and nothing glrs does writes it. `"agentConfigAllowlist": ["extensions"]` opts that one section out. With it, a `configure_extension` tool records what you said; without it the suggestion still happens and glrs tells you the line to add instead. The tool is registered only when there is something undecided and only when the answer can actually be written, since a decline that cannot be recorded lasts until the next turn.

  `/extensions` now lists what ships but is not loaded alongside what is, and `/extensions enable <name>` and `/extensions disable <name>` do the same thing by hand. Unlike the extension lists, `agentConfigAllowlist` is nearest-wins rather than additive: permission to write your config is not something a project you cloned should be able to widen.

- 483386e: The tools that touch the machine are an extension now, so replacing one is registering its name.

  `packages/extensions/builtins` owned seven slash commands and nothing else, while `bash`, `read`, `write`, `edit`, `grep` and `glob` were merged straight into the agent ahead of every extension. So the sentence the extension docs print in bold — _the core registers no slash commands and no tools of its own_ — was a claim the code did not support, and the package named `builtins` was the one place the built-ins were not.

  They are the `builtins` extension now, registered through `g.tool` exactly as a tool you write is: same wrapper, same gate, same 30k result cap, same rows. `activate_skill` is the one tool the core still registers, because it needs a skill's body and the extension API does not carry one.

  Replacing a tool no longer means shadowing anything. A tool name is kept by whoever claims it first and your project is walked before anything shipped, so registering `bash` in `.glrs/extensions/` simply wins. Shadowing by filename still works, but naming a file `builtins.ts` is a blunter instrument than it was — it now costs the six tools as well as the commands and leaves the model unable to do anything, so glrs says so at startup when it happens.

  `g.settings()` is new on the extension API, carrying the resolved config so a tool can read `tool_timeout_ms` without importing the coding agent. Provider blocks are deliberately absent: they hold API keys.

  **The path check on `read`, `write`, `edit`, `grep` and `glob` is gone.** Relative paths resolve against the project root, absolute paths are taken as given, and nothing is refused. It never bounded what the agent could touch — `bash` sat unconfined beside those five the whole time — so all it did was make the model reach a file the slow way after being told no on the direct one, which is a thing that actually happened and is why `~/.config/agents` was carved out as an exception. glrs runs in YOLO mode by design; this is that, without the theatre.

  The move also settled a long-flaky test. `tools.test.ts > gives separate registries distinct event IDs` timed out under load for months because it built two full tool registries and called `loadSkills(process.cwd())` to do it — and passed at all only because this repository happens to ship a skill. It tests two wrapped tools now and runs in a millisecond.

- ea99ba7: Config decides which extensions load, and the ones that add a capability now wait to be asked for.

  Turning off a bundled extension meant shadowing it with a file of your own that did nothing — and an npm-installed glrs has no file to delete, so `web_fetch` was a tool you could not decline. `extensions.disable` names one and it does not load, from any of the four config files.

  **`web-fetch` and `ask-user` no longer load by default.** They ship in the box and wait for `{"extensions":{"load":["web-fetch"]}}`. `builtins` is the exception and loads unless you explicitly disable it, because it carries the six tools and every slash command and an agent without them cannot do anything. This is a visible change on upgrade: `web_fetch` and `ask_user` disappear from an existing install until named.

  `load` takes a shipped extension's name, the package it ships as, or a path — relative to the config file that wrote it, or absolute. Naming it by package specifier works today against the bundled copy and keeps working the day these are installed rather than shipped, so a config written now survives that change. `tools.disable` is a sibling key that withholds a tool name from the model whichever extension registered it, riding the same filter seam `g.filterTools` uses so the two intersect rather than one overwriting the other.

  Unlike every other setting, these lists **add up across all four config files** rather than the nearest one winning. They are sets, not values: a project activating one extension must not switch off the one your personal config activates everywhere. `disable` beats `load` from any layer, because turning something off is the direction that has to be safe.

  A name in `load` that resolves to nothing is a failure and says so under the spelling you wrote. A name in `disable` that matches nothing is only a note — nothing is broken, and the usual cause is `web_fetch` typed for `web-fetch`.

  `glrs doctor` now lists what would load and where each one came from, resolved without running any of it. An extension is a program, and a diagnostic that executes programs is not a diagnostic. `/reload` re-reads config too, so editing `extensions.load` and reloading means the same thing as restarting — which is the one job anybody would use it for.

## 1.0.0-next.51

### Minor Changes

- ab86255: Two ways to send a message while the agent is working, and one key that takes any of them back.

  `Enter` queues a follow-up: it waits until the agent has finished everything and then becomes its own turn. `Alt+Enter` queues a steering message, which joins the turn that is already running. Enter is the follow-up because it is the one that cannot make things worse — it has no way to change what the running turn does — and steering is the deliberate act, so it carries the modifier.

  Steering is real now rather than a name for jumping the queue. It used to mean "become the next turn", which only helped after the model had already spent twenty steps going the wrong way. A steering message is appended to what the model sees at the next step boundary, through the AI SDK's `prepareStep`, so it is read before the next action is chosen and the turn is neither restarted nor thrown away. Appending keeps the cached prefix intact, so steering costs the tokens of what was said and nothing else. The message is spliced back into the turn's stored messages at the position it was delivered — left at the end, the assistant would appear to have answered something the conversation never says was asked, and a later compaction would summarise it in the wrong order. A dropped stream is re-sent from the first step, so anything the dead attempt took goes back in the queue rather than being delivered only to a request that was discarded.

  `Alt+↑` lifts the newest waiting message out of the queue and into the composer. There is no separate rescind and no separate edit, because taking it back is both: retype it and press Enter, or clear the line and it is gone. A slash command comes back as `/review` rather than the page of prompt it expands into.

  `Esc` now has one job. It stops the running turn and holds the queue rather than marching it on into whatever state the interrupt left behind — and it no longer pulls a queued message into the composer, which is what used to make Esc during a turn look like it had done nothing. `Enter` on an empty composer releases the hold; so does sending anything else.

  Two settings, `steering_mode` and `follow_up_mode`, choose whether one waiting message is delivered at a time (the default, so the model answers what you said before it reads what you said next) or all of them at once. Both are also read as `steeringMode` and `followUpMode`.

  New `terminal-setup` page: on Windows Terminal `Alt+Enter` is fullscreen and never reaches glorious, so it documents the remap. Alt is accepted under both conventions terminals use for it — the `ESC` prefix and the kitty protocol's modifier bit — so the chords work in terminals that speak neither exclusively.

- 57d7f1c: glorious is glrs, everywhere, and everything it wrote under the old name is still read.

  The docs site has been glrs.dev since it went up, and a real 1.0 is close enough that a rename after it would be a migration rather than a rename. So: the published package is `@glrs-dev/glrs`, the command is `glrs`, the internal packages are `@glrs-dev/glrs-core` and `@glrs-dev/glrs-coding-agent`, the extension API type is `Glrs`, and the agent introduces itself as glrs. First-party extension packages take a `glrs-ext-` prefix — `@glrs-dev/glrs-ext-builtins`, `-ask-user`, `-web-fetch` — so a package's kind is legible from its name once third parties publish alongside them.

  Nothing you already have stops working. `.glorious/` is read everywhere `.glrs/` is and `GLORIOUS_<name>` everywhere `GLRS_<name>` is, both at lower precedence, so a checkout or a shell profile written before the rename needs no edit. Project config still beats personal config whichever spelling each uses — a project pinning a model in `.glorious/` beats your personal `.glrs/`, because the rename adds a name rather than reordering precedence. Sessions are read from both stores and written to the new one, so resuming an old session migrates it and the old copy is left where it is. The old names will stop being read in a future major version. `glorious` also survives as an alias for the `glrs` command.

  **`write` reaches less than it did.** Widening writes past the project root exists so the model can save an extension or a skill to your personal agent directory without being refused. That grant used to be whole directories — all of `~/.glorious`, all of `~/.agents` — which was harmless only because nothing else lived there. `~/.glrs` is somewhere people keep checkouts, so a blanket grant would have let `write` leave one project and land in another. The grant is now the resources it was always about: `extensions/`, `skills/`, `commands/`, and `config.json` under each of those roots.

  Three things that had no tests now do, because the rename is exactly the kind of change that breaks them silently: the old config directory and environment variables still being read, the session store spanning both directories without listing a resumed session twice, and the write grant covering the resource directories and nothing around them. Session storage was untestable before this — the directories were module-level constants read at import, so pointing them somewhere disposable was impossible — and is computed per call now.

  One test was passing for the wrong reason and is fixed here: it asserted a file's contents were readable with `toContain("probe")` against a file named `zz-read-probe.txt`, so the refusal message — which quotes the path it refused — satisfied the assertion just as well as the file did.

### Patch Changes

- 4ffc38a: `ask_user` ships as its own package rather than a second entry point on the builtins one.

  `packages/extensions/builtins` exported two extensions: `.` for the slash commands and `./ask-user` for the question widget. They share nothing — no code, no types, no reason to be versioned together — and the arrangement made `builtins` a package whose name described half its contents. `ask_user` now lives in `packages/extensions/ask-user`, exporting one thing from one path, and the bundled roster names it `@glrs-dev/glorious-ask-user`.

  Nothing changes at runtime. The extension loads under the same name, registers the same tool, and still withholds itself in print mode where there is nobody to answer.

  The bundled roster had no test at all — three hardcoded static imports that nothing asserted actually loaded, so a move like this one was caught only by running the app. It has two now: every shipped extension loads without a failure, and each reports the origin it is supposed to. The louder failure was already covered by accident, since a path that stops resolving takes the whole suite down with it; these cover the quiet one, where an entry resolves but is wired to the wrong name.

  Also fixes a doc path that still pointed at `v2/bundled/ask-user.ts`, from before the monorepo move.

- 3bfc9b8: Stream direct `!` shell-command output while it runs, show running state, and clearly report silent completion or failure.
- ed64d60: The first extension to claim a tool name keeps it, and a tool filter no longer depends on load order.

  Two bugs in the same seam, both of which made what the model can call depend on the order extensions happened to load in.

  **A tool filter held names, not predicates.** `g.filterTools` resolved its predicate to a list of tool names once, at the moment it was registered. A tool belonging to an extension that had not loaded yet was simply absent from that list, so it stayed withheld for the rest of the session however permissive the filter itself was — a read-only extension that loaded early would withhold a tool it had never been asked about. The predicates are kept now and applied per model call, so a tool that arrives later is judged by the filter rather than missed by it.

  **Tool names were last-writer-wins.** Every other namespace in glorious is first-wins — commands, user commands, skills, the activity row — and the table in the extension docs states it as a general rule. Tool names were the exception, and the exception ran backwards: because extensions load project-first, the later an extension loaded the more it could take, so the ones glorious ships would have beaten a project's own. Registering `bash` in `.glorious/extensions/` now replaces the shipped one, and you do not have to shadow a whole extension to replace one of its tools.

  A registration that loses is reported rather than dropped in silence. `/extensions` lists it as `shadowed: bash` under the extension that tried, because that listing is the only account anyone gets of what a loaded extension did and claiming a tool it does not own would make the account wrong.

  Neither bug was visible to the type checker and neither had a test. Both do now, and both tests fail against the previous behaviour.

- 7a0d338: Generate glrs.dev with TypeDoc, a custom glrs theme, Mermaid diagrams, API reference pages, and long-form External Documents.

## 1.0.0-next.50

### Minor Changes

- c89147e: Bundle the new internal monorepo package boundaries into the existing `@glrs-dev/glorious` distribution.
- 034891b: Remove the sequence workflow, `$name` shortcuts, sequence discovery, and sequence references from the runtime and documentation. Reusable behavior belongs in commands or extensions.

### Patch Changes

- 3a57e0f: Refine the docs site around a terminal-core design system with stronger hierarchy, composition, navigation, and readable documentation outlines.
- fb3bb30: Improve docs navigation with section landing pages, side navigation, on-page outlines, stronger visual hierarchy, and a separated footer.
- 6f9a58c: Fix documentation outline navigation by deriving stable heading IDs from Markdown source positions.
- 39fc19e: Standardize documentation page titles and add visible anchor links to headings across the docs site.
- 39dcea3: Keep heading anchors on section headings only, with consistent whitespace and framework-level rendering.
- 2475b5c: Fix documentation page outlines so selecting a heading reliably updates the URL and scrolls to the section.
- 3a5a521: Keep installation details on the Install page, add the package-manager switcher directly beneath its heading, and document the planned core/coding-agent monorepo split.
- a22eaab: Move all documentation navigation into the persistent sidebar and remove the top navigation links.

## 1.0.0-next.49

### Minor Changes

- d9c331c: The completion list scrolls with the selection, and Esc dismisses it without interrupting.

  **The list was cut to six before the composer ever saw it.** `matchNames`
  sliced to six matches, and the composer draws a scrolling window over whatever
  it is given — so with 37 commands the other 31 did not exist. Scrolling could
  not reach them, and the `↓ n more` line, which counts what the window is not
  showing, had nothing to count. Ranking now says what is likeliest and the
  composer decides how much fits.

  **The window is bounded by the terminal, not by a constant.** It was a flat ten
  rows and never asked how tall the terminal was, so on a short one the last rows
  were clipped and moving the selection into them looked like a list refusing to
  scroll.

  **Esc closes the menu and leaves what you typed alone**, without interrupting
  the turn — you were dismissing a menu, not abandoning the line or stopping the
  model. The dismissal is remembered against the text it happened on, so the menu
  stays shut while you look at it and reopens as soon as you type again; a second
  Esc reaches the interrupt as before.

## 1.0.0-next.48

### Patch Changes

- 3d71695: The unconditional publish guard runs before the version bump, not after.

  Placed after `changesets/action`, it read a `package.json` the action had
  already bumped in the same workspace — so it published the _next_ version, whose
  PR nobody had merged. That released unmerged code and made version PRs
  decoration.

  It runs before the action now, where the workspace is still exactly main, so it
  publishes only what main has committed.

- ba36c55: The release workflow publishes whatever version main is at.

  Three versions were bumped on main today and never reached npm — `next.25`,
  `next.36`, `next.46` — each rolled over by the following release and lost.

  The publish guard was already idempotent, but it only ran when
  `changesets/action` chose to call it, and the action publishes nothing when it
  sees an unconsumed changeset: it opens a version PR instead. So a version PR
  whose branch predated the newest changeset would merge, bump `package.json` on
  main, and publish nothing — stranding that version permanently.

  The same guard now also runs as its own unconditional step. Every push to main
  converges on "npm has what main says", so a skipped version is repaired by the
  next push instead of being rolled over. The guard also confirms the registry
  actually serves what it just published, rather than assuming, because the
  dist-tag step after it would otherwise point `latest` at something nobody can
  install.

## 1.0.0-next.47

### Patch Changes

- 75cb1ff: A failed turn no longer reports `[object Object]`.

  `errorText` used `String(thrown)` for anything that was not an `Error` — and
  provider SDKs throw plain objects routinely, so a turn could fail and the
  transcript would say nothing at all about why.

  It now digs the message out: a nested `error`, a response `body`, an empty
  `Error` with a populated `cause`, the first of an `errors` array. Anything
  genuinely unrecognisable is serialised, because a wall of JSON is worth more
  than `[object Object]`. Extension load failures go through the same path.

  Observed shape, before and after:

  ```
  { status: 400, error: { message: "This model's maximum context length is 272000 tokens." } }
  before: [object Object]
  after:  This model's maximum context length is 272000 tokens.
  ```

## 1.0.0-next.46

### Patch Changes

- cf4624c: The lifecycle diagram showed literal asterisks.

  Mermaid does not render markdown inside sequence-diagram labels, so the `**` used
  to mark hooks that can change what happens next appeared as asterisks rather than
  bold. A `◆` marks them now, with the legend saying so.

## 1.0.0-next.45

### Minor Changes

- 548c5c3: The request pipeline is interceptable, and the lifecycle is documented.

  Three new events close the two biggest gaps in the extension API.

  **`context`** fires before _each_ model call — a turn running three tools fires
  it four times — and hands over every message. Returning an array replaces what
  is sent for that call only, so filtering, windowing and redaction are possible
  and stored history is never rewritten. `before_request` could only append a
  string to the turn's message.

  **`before_provider_request`** sees the HTTP request as the provider will:
  returning `{ headers }` merges them, returning `{ body }` replaces it. Gateways,
  signing proxies, per-request auth and request logging live here.
  **`after_provider_response`** sees the status and headers before the body is
  read, which is where rate-limit budgets and request ids arrive.

  Handler return types are now per-event. `HandlerVerdict` was one loose
  `string | false` shared by every event, so a handler could return a value to an
  event that ignores it and nothing said so — the compiler now rejects it.

  New `docs/published/lifecycle.md`: a sequence diagram of a turn from prompt to
  answer, plus a table of every event and what returning something does. Two tests
  keep it honest — every event must appear on the page, and the page may not
  invent one.

## 1.0.0-next.44

### Minor Changes

- acb18c5: Every extension API member is tested, and every lifecycle event fires in both hosts.

  Nineteen of the API's forty members had never been named in a test. That is how
  `before_request` came to fire in the TUI and silently do nothing under `-p` — an
  extension injecting per-turn context worked interactively and was inert
  headlessly, which is the mode the agent uses to check its own work, so the gap
  concealed itself.

  **Five events now fire in print mode that did not:** `before_request`,
  `message`, `reasoning`, `error` and `session_end`. `input`, `user_bash`,
  `model_select` and `compact` remain TUI-only, and a test names each one with the
  reason.

  **Two guards keep it that way.** A Proxy records every member the tests touch,
  so adding an API member without testing it fails the build rather than shipping
  untested. A parity test asserts every event fires in both hosts unless it is on
  the exceptions list, and that the list contains no stale names. Both were
  verified to fail against the code they were written to catch.

- 2639f73: A dropped stream is re-sent instead of killing the turn.

  `the connection to the model dropped mid-response` ended the turn and discarded
  everything in it — in one observed case, eleven completed tool calls. The retry
  that already existed could not help: `fetchWithDeadline` retries while the
  request is being _made_, and a mid-response drop happens long after `fetch()`
  resolved, while the body is being read. Nothing was watching that.

  The stream is now re-sent, up to three attempts with a widening pause, **exactly
  while the attempt is unobservable** — no text written, nothing thought aloud, no
  tool run. Then re-sending is invisible and safe. Once anything has been
  produced, a re-send would duplicate it or run a tool twice, so the failure
  surfaces as before and the reminder tells the model it was interrupted.

  The decision is one predicate, `shouldResend`, tested for each way it can go:
  nothing produced, something produced, Esc pressed, attempts exhausted, and a
  failure that is a refusal rather than a drop. A retry announces itself in both
  the TUI and `-p` rather than looking like a stall.

## 1.0.0-next.43

### Minor Changes

- 9c3f4de: `/reload` reloads extensions, and `write` can reach the directory the docs point at.

  Two defects from one live session, where glorious was asked to give itself a new
  capability and then could not use it.

  **`/reload` did not reload extensions.** It re-read skills, commands and
  sequences, reported `(reloaded — 28 skills, 37 commands, 0 sequences)`, and said
  nothing about the one thing it had skipped. Installing an extension — which is
  what glorious does when it extends itself for you — required a restart to see.
  It now resets the registry and re-imports every extension with a cache-busting
  token, so an edited extension is re-read rather than served from the module
  cache. Load failures are reported the same way they are at startup, and the
  message counts extensions.

  **`write` refused `~/.config/agents/extensions/`.** The docs tell the model to
  put a personal extension exactly there; `write` and `read` refused the path for
  being outside the project, so the model installed it with a `python3` heredoc
  through `bash` — which is unconfined, so the guard bought nothing and cost a ✗
  row and a clumsier path. `read` and `write` now reach glorious's own directories
  (`~/.config/agents`, `~/.agents`, `~/.glorious`, `~/.config/glorious`) and
  nothing else under home. This is the same lesson as the earlier fix for the docs
  directory, learned a second time.

## 1.0.0-next.42

### Patch Changes

- 55d949a: A NUL byte made a bundled extension unsearchable.

  `v2/bundled/builtins.ts` used `process.env.HOME ?? "\0"` as a sentinel — chosen
  because no path starts with a NUL. It was harmless at runtime and invisible on
  screen, and it made the entire file **binary to ripgrep**, so every search of it
  silently returned nothing. That is glorious's own `grep` tool as much as
  anyone's: a file the agent cannot search is a file the agent cannot maintain.

  The sentinel is gone; the check says what it means. A test now walks every `.ts`
  file and fails on any C0 control character other than tab, newline and carriage
  return.

## 1.0.0-next.41

### Minor Changes

- 34b6db0: Four places in the extension API where a reasonable extension got a wrong answer.

  **`g.exec` reports the exit code and stderr.** It returned `{output, stdout, ok}`,
  and `ok` collapsed every failure into one bit — exit 1 (the linter found
  problems) and exit 127 (the linter is not installed) are opposite situations and
  were indistinguishable. Now `{output, stdout, stderr, code, ok}`.

  **`g.setTools` is replaced by `g.filterTools`.** It set one global list, so the
  second extension to restrict tools silently undid the first and neither could
  see the other. A filter is a predicate, every extension's filter has to agree,
  and the handle it returns lifts yours and nobody else's. Restrictions now
  compose and can only narrow.

  **`g.entries(type)` reads back what `g.appendEntry` wrote.** There was no read
  path at all: an extension could persist data into the session file and never
  recover it except by opening `session().file` and parsing it itself. Entries
  survive `--resume`, since a resumed session replays them.

  **`g.print(content, tone)` honours `tone` for `Line[]`.** It only ever reached
  `noticeBlock`, so a tone passed with spans was silently dropped. Spans that name
  their own tone keep it; the rest take the one you passed.

## 1.0.0-next.40

### Minor Changes

- 1ac1a27: The core no longer knows what a question is.

  `ask_user` was a built-in tool, and 234 lines of question widget lived in the
  renderer to serve it. Both are gone. `ask_user` is a bundled extension now,
  written against the extension API like anything else — delete it and the model
  loses the ability to ask; write your own and it is not competing with anything
  privileged.

  `g.ask`, `g.ui.select`, `g.ui.confirm` and `g.ui.input` are replaced by one
  primitive:

  ```ts
  const held = g.ui.capture({
    render: (columns) => Line[],     // draw the composer area
    onKey: (key) => void,            // every keypress, until you close
  });
  ```

  Those helpers looked generic and were not. `g.ask` returned a **JSON string** —
  because that is what a tool must return to a model — and `select`/`confirm`/
  `input` worked by `JSON.parse`-ing it back out. `g.ui.input` faked free text by
  offering a single option labelled "Type your answer as a note". The shape of a
  model's tool result had leaked into the extension API and become its input
  abstraction.

  Now the host owns "you have the composer and the keys" and nothing else. The
  bundled `ask-user` extension is a complete question widget — a cursor, several
  questions in sequence, free-text notes, dismissal — built on `capture` alone,
  and its answers reach the model as prose rather than JSON, because formatting
  for a model is the tool's job.

  Also: the guidance telling the model to use `ask_user` moved out of the core
  system prompt into the extension. Removing the tool used to leave the model
  instructed to use something that no longer existed.

## 1.0.0-next.39

### Minor Changes

- 9c82575: A config that does nothing now says why.

  `{"model": {"selected": "azure/gpt-5.6-sol"}}` in a project file ran for a week
  as the default model. The key was recognised and the value was the wrong type,
  so it was dropped exactly as silently as a typo — and the comment above that
  code said "a config that silently does nothing is the hardest kind to debug".

  - **A recognised key holding the wrong type is reported.** `"model" should be a string like "azure/gpt-5.6-sol", got object — ignored`.
  - **A file where nothing at all is recognised is reported**, naming the keys it found. That catches a config written for another agent, or for an older glorious with a nested `agent.llm` shape.
  - **Diagnostics appear at startup**, not only under `glorious doctor`. Doctor is a command you run once you already suspect something, and a silent config gives you nothing to suspect.

  Keys glorious does not know, in a file where it knew something, stay ignored and
  silent. A config that has grown a key is not a broken config.

  `.glorious/config.local.json` is read as the nearest layer — the conventional
  name for the copy you do not commit, and the first thing anyone reaches for. It
  was silently not a file glorious opened.

  Print mode built its model with `currentModel()` and no arguments, so a model
  set in `.glorious/config.json` worked in the TUI and was ignored by every
  headless run — including the ones the agent uses to verify its own work.

  `loadConfig` takes the home directory as a parameter, for the same reason
  `loadSkills` does: the tests read whatever config was installed on the machine
  running them, which is green on CI and red on a laptop that has one.

- 39469a9: Expand the published documentation with shared user-facing references, configuration guidance, troubleshooting, and a generated extension API reference. Add configurable built-in tool timeouts through `tool_timeout_ms` and `GLORIOUS_TOOL_TIMEOUT_MS`.

## 1.0.0-next.38

### Minor Changes

- 0df94e9: Skills answer to `/skill:name`.

  They took the bare `/name`, which put them in the same table as every command an
  extension or a markdown file registers — so installing a skill could quietly
  shadow a command you already had, and looking at `/deploy` told you nothing
  about which of the two it was. The prefix says where a command comes from.
  `trigger:` now renames the part after the colon.

  Completion is a fuzzy match, so typing `/changelog` still finds
  `/skill:changelog` — the prefix does not have to be typed. Commands keep their
  bare names; skills are namespaced because they arrive from somewhere else.

  A colon had to become legal in a command name for any of this to parse. It was
  not, so `/skill:name` matched nothing and fell through to "unknown command".

  Also fixes the skills tests, which searched the real home directory and so read
  whatever skills were installed on the machine running them — green on CI, red on
  any laptop with skills of its own. `loadSkills` takes the home directory as a
  parameter now; `homedir()` ignores `$HOME` on Bun, so there was no way to point
  it somewhere empty from a test.

## 1.0.0-next.37

### Minor Changes

- c77e89f: Skills follow the Agent Skills standard, and say when they cannot.

  - **Every field the standard defines is recognised** — `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools` — alongside glorious's own `trigger`. Fields nothing knows about are ignored rather than rejected, so a skill written for another agent loads here unchanged. `allowed-tools` is parsed and shown; nothing is restricted to it yet.
  - **`disable-model-invocation: true`** keeps a skill out of the system prompt and out of `activate_skill`, leaving it available as `/name`. **This field is not part of the Agent Skills specification** — it is a convention several agents arrived at independently, common enough now that a skill carrying it expects it honoured. `docs/skills.md` says so plainly rather than implying the standard promises it.
  - **Discovery is recursive.** Only the top level of each skills directory was searched, so skills grouped into folders — which is how anyone with more than a handful organises them — were invisible. A directory containing a `SKILL.md` is a skill and is not searched further, so its own `references/` and `scripts/` are never mistaken for more skills.
  - **Validation is lenient and loud.** A non-standard name, an oversized description, a directory whose name no longer matches the skill: each warns in the transcript and loads anyway. Only a missing name or description stops a skill loading. Previously every one of these was a silent drop — a skill whose folder had been renamed simply ceased to exist, which looks exactly like a skill nobody wrote.
  - **Name collisions warn** instead of silently keeping the first.
  - **`/skills` shows what the model can reach.** A skill that opted out is tagged `you only`, and the heading counts how many of the loaded skills are actually offered.

  New `docs/skills.md`, named in the system prompt, covering the layout, the
  frontmatter, progressive disclosure, and when a skill should have been a command
  instead.

## 1.0.0-next.36

### Minor Changes

- 46475b9: A tool call is one line.

  ```
    ✓ read    v2/render.ts · 432 lines                            8ms
    ✓ grep    "toolRow" in v2/ · 2 matches                      124ms
    ✗ edit    v2/render.ts                                       24ms
      old_string not found in file
    ✓ bash    bun test --timeout 60000 · 308 pass               23.8s
    └ 4 calls · 24.0s · 1 failed
  ```

  It was five lines per call, so a turn doing twelve things cost sixty lines of
  scrollback to carry maybe three facts worth having.

  What comes back is a summary rather than a tail — `432 lines`, not the last
  three lines of the file. Tools describe their own results, and an extension's
  tool describes itself through `renderResult`, whose first line is what lands in
  the row. One seam, not two, so nothing can drift.

  Only a failure earns a second line, carrying the reason. It is the one piece of
  output nobody should have to go looking for.

  The footer closes a run of calls — everything between two things the model said
  — and is the receipt no individual row can give. A single call gets none,
  because the row above already says it.

  The tool name has a fixed column, so calls align without any row knowing about
  the others. Nothing is buffered or redrawn to achieve it: each row still prints
  as its call lands, and the footer is one more line after the last of them. Live
  rendering, session replay and print mode fold events through the same rule.

## 1.0.0-next.35

### Minor Changes

- 40ded80: `@` finds directories, searches the whole tree, and scrolls.

  Three separate limits made `@` less useful than it looked:

  - **It only ever offered files.** A directory was never a candidate, and one typed by hand was reported missing. `@src` now attaches the listing of what is under it — the paths, not the contents, which is what lets the model pick what to read without a directory costing the context window.
  - **It stopped searching early.** The old hand-walk gave up at six levels deep and after 400 entries — whichever 400 `readdir` reached first — so a file plainly visible in an editor did not exist as far as `@` was concerned. It uses ripgrep now, which ships with glorious already: no depth limit, `.gitignore` respected, and one listing cached across the burst of keystrokes that makes up a query.
  - **It capped at 8 matches with no way past them.** The list painted every match and sized the panel to fit, which was only survivable because of the cap. It shows a scrolling window now, with `↑ n above · ↓ n more` so there is a reason to press down.

  Ranking changed with it. Sorting by depth first put `test/a/b/util-helper.ts`
  above `src/utils.ts` for `util`, because it ranked where a file sits over what it
  is called. A name that starts with what you typed wins, then a name that contains
  it, then everything else.

## 1.0.0-next.34

### Minor Changes

- 04cb00b: `/compact` says what it is doing while it does it, and shows what it kept.

  Summarising a long conversation is a model call that can run for minutes. It ran
  with nothing on screen — the composer emptied, no row appeared, and a command
  that was working read as one that had died. It now rides the same phase signal a
  turn does, so the status row counts it out (`compacting 42.1s · Esc interrupt`),
  and the same abort controller, so Esc stops it and leaves the conversation
  exactly as it was.

  When it finishes, the brief is printed. It was already announced as an event and
  then rendered as nothing, so a compaction was a line saying some number of
  messages went away with no way to see what survived them.

  Slash commands echo what was typed, the way `!` and `$` already do. Without it
  the composer emptied and, for anything slower than instant, nothing took its
  place.

  Compaction also reported itself twice, in two different formats with two
  different numbers. One line now, from the place the compaction happens, so an
  automatic one reads exactly like an asked-for one.

  Tool row output lines are indented a step further than the call and the
  duration, which frame them.

## 1.0.0-next.33

### Minor Changes

- b46220b: Tool rows read as the call that was made.

  ```
    ✓ bash(git status --short)
      ↳ M v2/render.ts
      ↳ M v2/index.ts
      completed in 1.2s
  ```

  The name and its arguments sit together on the header the way they were
  written, rather than the name alone with the arguments stranded on the line
  below. Arguments fold onto a second line when a one-line budget is not enough —
  a command with a path in it used to spend the whole line on the path — and the
  fold prefers a space, because breaking a path mid-segment reads as two paths.

  Output hangs off arrows, so the tail of a 30k result is three lines that are
  visibly output rather than three lines that could be anything. The duration
  closes the row instead of sitting in the header, where it competed with the
  arguments for the part of the line the eye lands on first.

  Print mode calls the same renderer now. It had a second copy of this layout
  written out by hand, which is exactly how two views of one call drift apart.

## 1.0.0-next.32

### Minor Changes

- ddf0eea: Read personal config from `~/.glorious/config.json` as well.

  Extensions and commands already come from `~/.glorious/` — the ancestor walk reaches it whenever a project sits under home — but config was read only from the project and `~/.config/glorious/`. The same directory holding your resources but not your settings is a rule nobody should have to learn. Both personal locations are now read, merged nearest-first one key at a time, so a project can pin the model while your personal config supplies the provider settings it does not mention.

  Also fixes a lint error that reached main: a regex written with a literal escape character, in the test that tolerates ANSI in a child process's output.

### Patch Changes

- 35785f6: `/help` now describes what Esc actually does: it interrupts the turn, and only takes back the newest queued message when nothing is running. The line read "interrupt the turn · drop the newest queued message" as if it did both — which is exactly the behaviour that was fixed when it stopped silently dequeueing mid-turn.

  Also makes a test immune to the environment it runs in. It spawns a child and parses its stdout as a number; with `FORCE_COLOR` set in the parent — which a terminal or a CI wrapper may well do — Bun wraps even a bare number in colour codes, so the parse yields `NaN`. It failed locally and passed in CI, which is the worst way for a test to be wrong: it teaches you to ignore a red suite.

## 1.0.0-next.31

### Minor Changes

- e92224a: Compaction, `@file` references, piped input, readable listings — and two queue bugs.

  **Compaction.** A conversation past 75% of the model's window is summarised automatically: the older part becomes a brief, recent turns stay verbatim. `/compact [instruction]` does it on demand. The cut always lands on a user message, because a tool result separated from the call it answers is an invalid request that the provider rejects outright. A resumed session inherits the compaction rather than re-inflating to the full history and hitting the same limit on its first turn. This was the only gap that made a long session _fail_ rather than merely be less convenient.

  **`@path` references.** The path stays in the message the transcript shows — it is what you typed — and the file's contents ride along fenced. `@` completes against project files in the composer. A path that escapes the project is left as written, so an email address is just text, and a missing file is reported rather than silently dropped.

  **Piped input.** `cat log | glorious -p "what failed?"` merges stdin into the prompt, fenced as material. Previously piped input was discarded entirely.

  **Readable listings.** `/help`, `/skills` and `/extensions` were ragged one-per-line lists with absolute paths on their own lines, three of which turned a five-line listing into fifteen. They are now aligned columns with the origin as a word — `bundled`, `project`, `personal` — which is the part that actually matters. Adds `/session`: id, context, tokens, cache hit rate and cost. Extensions get `g.columns()` and `g.clip()` so anyone can draw a table that fits.

  **Provider names people actually type.** `vertex`, `bedrock`, `gemini`, `claude`, `foundry`, `together`, `grok` and others resolve to the built-in provider. The canonical ids follow the SDK packages, which is fine for identifiers and not what anyone reaches for — `glorious --model vertex/gemini-3.7-flash` used to report Vertex as an unknown OpenAI-compatible endpoint and ask for a base URL. A genuine near-miss now names the provider it thinks you meant.

  **Two queue bugs, both reported from live sessions.** Esc dequeued before it aborted, so pressing it during a turn with anything queued silently pulled the queued message back into the composer and let the turn run on — the message was never sent and nothing about the turn changed, which reads as Esc doing nothing. It now stops the turn and leaves the queue alone, and taking a message back says loudly where the text went.

  The interrupt reminder led the prompt, ahead of what was typed. A model that had just been interrupted answered the reminder instead of the request — replying "Retried successfully" to a page of new instructions. The request leads now; the reminder trails it.

  New: `docs/features.md`, the built-in feature set in one place.

## 1.0.0-next.30

### Minor Changes

- 41bf890: Standard providers, and endpoints that are not standard.

  Fifteen providers now declare their own credentials in one table: Anthropic, OpenAI, Azure OpenAI / AI Foundry, Google Gemini, Google Vertex AI, Amazon Bedrock, OpenRouter, Groq, Mistral, DeepSeek, Cerebras, Cohere, xAI, Perplexity and Together AI. Only Azure did before; every other provider fell through to whatever variable its SDK happened to read, so glorious could not say what was missing and could not accept the second name a provider answers to.

  **OpenAI-compatible endpoints now work at all.** An id glorious does not recognise is routed to an OpenAI-compatible client given a base URL — Ollama, LM Studio, vLLM, llama.cpp, a gateway, a company proxy. This previously threw `Provider ollama is not supported` no matter what was configured, because the compatible path was reachable only if models.dev happened to publish the provider, which no local server does.

  ```json
  {
    "model": "ollama/llama3.3",
    "providers": { "ollama": { "api": "http://localhost:11434/v1" } }
  }
  ```

  `doctor` now names the provider and what is absent, rather than only the model:

  ```
  model: groq/llama-3.3-70b
  provider: Groq
  missing: GROQ_API_KEY
  ```

  The models.dev catalogue is cached to `~/.cache/glorious/models.dev.json`, so context windows and prices survive being offline instead of the status line falling back to `unknown` on the first flight without a network.

  Adds `--model provider/model-id`, which takes precedence over everything but nothing else, and works alongside `-p` and `doctor` in any order. Two flag-parsing bugs fixed on the way: `doctor` was only recognised at argument zero, and a bare word anywhere was accepted rather than reported as the typo it is.

  New: `docs/providers.md`.

## 1.0.0-next.29

### Minor Changes

- b5d70e3: Give a tool call three lines instead of one.

  ```
  ✓ bash  1.2s
      git status --short
      M v2/render.ts
      ?? notes.txt
  ```

  The header carries only what is true at a glance — did it work, what was it, how long did it take — and the duration appears only once there is one, so a running call reads `→ bash` with its arguments and no number counting up in place. Underneath: the arguments, then the last three non-blank lines of the output, each clamped. A 30,000-character result contributes three lines, never thirty, and the tail is kept rather than the head because a command's last lines are the ones that say how it ended.

  Output is shown for calls that succeeded, not only ones that failed. A `grep` that found three matches now says which, and a `bash` that printed something says what.

  Print mode draws the same three parts, so a piped trail and a watched session describe a call the same way.

  An extension's `renderCall` / `renderResult` replaces the body; the mark and the duration stay glorious's, so they mean the same thing on every row whoever wrote the tool.

## 1.0.0-next.28

### Minor Changes

- 799f94b: Colour the queued count like the rows it counts, and let an extension own the activity row.

  The `· 2 queued` in the busy row was accent, the same tone as the phase and the interrupt hint, so it read as part of the hint rather than as a tally of the warning-toned queued rows sitting directly above it. It is now the same warning tone, and on a terminal too narrow for everything the count is what goes — the queued rows already show it, while the live phase reading and the way to stop the turn do not appear anywhere else.

  The row is also replaceable now. `g.activity(render)` is handed `{ busy, queued, phase, columns }` and returns `Line[]` to own the row, or `null` to leave glorious's own. First extension to return lines wins, so a project overrides a personal one the same way it overrides a command, and one that throws loses only its turn at that frame.

  That was the last thing glorious drew that an extension could not touch. Every rendered surface — tool rows, the status line, the footer, and now the activity row — is either replaceable or contributed to.

## 1.0.0-next.27

### Minor Changes

- 40fa26b: Expose everything the core already knew about tokens, cache and cost.

  Three things had drifted apart: what glorious computes per model call, what it writes to the session, and what an extension can see. Usage was computed in full — input, output, cached, cost — persisted in full, and exposed as `{ tokens }`. There was no usage event at all, so a cost tracker or cache-hit monitor could not be written.

  Now `usage` fires once per model call with `{ input, output, cached, cost, contextTokens }`, and `g.usage()` returns the live context size, the model's window, the last call, and a session total including `steps`. The total is summed from the session's own events, so a resumed session reports what the whole session cost, and `/clear` does not reset it — clearing drops what the model replays, not what the run spent.

  The same drift elsewhere, closed: `tool_end` now carries `detail` and `elapsedMs`; `reasoning` (with how long the model thought) and `error` are observable rather than only recorded.

  A tool call is now timed once, where it runs, and the measurement travels on the event. `chat.ts` used to pair start with end and subtract, so the transcript and anything else reading the same call could disagree about its duration.

  Print mode reached parity: it never hydrated model pricing, so every headless cost was zero — in the one mode you would script a cost report from — and it never fired `idle`, so an extension reporting totals on settle worked interactively and did nothing under `-p`.

  A test now reads the source and asserts every field on a session event appears in the matching payload, so these cannot drift apart again.

## 1.0.0-next.26

### Patch Changes

- e051f53: Say why a tool call failed.

  A failed row read `✗ edit 2 files  24ms` and stopped there. The reason was never hidden from the _model_ — it is the tool's return value, and `edit` reports which file and which replacement did not match — but it never reached the transcript. So a failure the agent then worked around looked, from the outside, like nothing had happened, and the only way to find out was to ask the agent what it had just done.

  A failed row now carries the reason underneath, clipped to one line:

  ```
  ✗ edit  2 files  24ms
      file 2/2 (b.txt) edit 1/1: old_string not found. Nothing was written. Re-read the file.
  ```

  `-p` does the same on the tool trail, so piping to a log no longer loses it. The `ERROR:` prefix is dropped — the `✗` already says that — and a 30k result is clipped rather than pasted into the transcript.

  Worth stating, since a failed multi-file edit invites the opposite assumption: no file was written. `edit` resolves every replacement across every file before touching disk, so one bad match leaves the tree exactly as it was, including files whose own edits were fine.

## 1.0.0-next.25

### Patch Changes

- e3ece91: Bring the shipped docs level with the API.

  `docs/` is what the agent reads to extend itself, so anything missing from it is invisible to the agent no matter how well it works. Three parts of the API had shipped undocumented: `g.root`, and `g.ui.select` / `g.ui.confirm` / `g.ui.setInput` — the last of which is how an extension asks a question at all.

  Also corrected drift: `tools.md` said permissions did not exist, which stopped being true when `tool_call` gained the ability to block a call; `architecture.md`'s module map still listed a deleted file and none of the extension modules; `models.md` said there was no model picker without mentioning that `g.models()` and `g.setModel()` make one writable. `models.md` now also says what happens when a connection drops mid-turn and how to resume.

  Added a caution the docs earned the hard way: a gate that refuses a tool when `g.hasUI` is false makes `glorious -p` unusable — including the run an agent uses to verify its own work, which then retries until something times out.

  Checked by extracting every method, event and `ui` member from the types and asserting each appears in `docs/`, rather than by reading.

## 1.0.0-next.24

### Patch Changes

- fd6b6b1: Retry a dropped connection instead of killing the turn.

  A turn could die with `The socket connection was closed unexpectedly. For more information, pass \`verbose: true\` in the second argument to fetch()` — a message about a fetch you never called, on a failure that a retry exists for.

  The retry filter matched on `error.name`, but Bun reports a dropped connection as a plain `Error` whose name is `"Error"`; the only signal is `code: "ECONNRESET"`. Nothing matched, so the failure was treated as permanent and the first network blip ended the turn. It now matches on `code` as well: ECONNRESET, ECONNREFUSED, ECONNABORTED, EPIPE, ETIMEDOUT, EHOSTUNREACH, ENETUNREACH, ENETDOWN and EAI_AGAIN. ENOTFOUND is deliberately absent — a hostname that does not exist will not start existing on the third attempt.

  That covers a connection lost before the response begins, which is retried transparently. One lost _mid-response_ cannot be: tokens may already be on screen and replaying the request would duplicate them. For that case the message is now one you can act on — "the connection to the model dropped mid-response — send \"continue\" to pick up where it stopped" — and the failure already leaves a reminder on the next turn, so the model knows what it was doing. Bare `fetch failed`, ECONNREFUSED and DNS failures get the same treatment.

## 1.0.0-next.23

### Minor Changes

- 7eeb682: Make the extension API deep enough to rebuild anything the core removed.

  The API could register tools, commands, hooks and UI, but not reach the things that decide what a session _is_ — so plan mode, the model picker and keybindings were gone rather than relocated. Now they are writable.

  **Tool gating.** `tool_call` fires before a tool runs; returning a string or `false` blocks it and hands the model your reason by name, so it chooses something else instead of seeing an unexplained failure. `tool_end` can rewrite what the model is told came back. Both wrap every tool — built-in, bundled and third-party — because all of them go through the same wrapper. A read-only mode is now eight lines in a file, and the core knows nothing about it.

  **Tools and models.** `g.tools()`, `g.setTools(names | null)` — withholding, not forbidding, so there is nothing to argue with. `g.model()`, `g.models()`, `g.setModel(label, variant)`: the picker is rebuildable.

  **Keys and CLI flags.** `g.key({ key, ctrl, run })` runs before the composer sees the key. `g.flag(name, spec)` claims `glorious --name value`; because extensions load long after argv is parsed, unclaimed flags are carried and dispatched once their owner exists, and one nothing claims is reported rather than ignored.

  **Turn and session control.** `idle()`, `pending()`, `abort()`, `usage()`, `systemPrompt()`, `shutdown()`, `session()`, `setSessionName()`, `appendEntry()` (persisted, never sent to the model), `markdown()` (display-only transform), and an `events` bus for extensions to talk to each other.

  **More events**: `session_end` (awaited, so a flush on the way out completes), `user_bash`, `before_request` (a string is appended to that turn's message), `message` (streaming deltas), `idle`, `model_select`.

  **Run mode.** `g.mode` is `"tui"` or `"print"` and `g.hasUI` is false headlessly. Anything needing a person throws in print mode rather than hanging, so an extension that guards on `hasUI` works in both.

  Fixes a bug this surfaced: the session picker opened for _any_ argument, because resuming keyed on `args.length === 0` rather than on `--resume` being present. `glorious --anything` now starts a session.

## 1.0.0-next.22

### Minor Changes

- 0747b43: The core registers no slash commands and no tools of its own.

  `/help`, `/clear`, `/skills` and `/extensions` were built in, and two of them could not have been written as extensions even in principle: the API exposed neither the skills catalogue nor the extension registry. A core that keeps capabilities its own extension API cannot reach is not extensible, it is just small.

  All of them — plus a new `/reload` — now ship as `bundled/builtins.ts`, written against exactly the API a third party gets. With `web-fetch` already bundled, glorious ships nothing the core privileges: shadow any of them by name from `.glorious/extensions/`, or delete them and write your own. Nothing in the core depends on them existing.

  The API gains what they needed: `g.inspect()` returns `{ commands, skills, extensions }` — every listing is a view over it — `g.clear()` drops the conversation the model replays, `g.reload()` re-reads from disk, and `g.print()` now takes `Line[]` as well as a string so an extension can draw styled output into the transcript.

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
  - **Named shell shortcuts.** The old markdown workflow that ran a shell command and optionally fed its output into a prompt has been removed. Reusable behavior belongs in extensions or commands.
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
