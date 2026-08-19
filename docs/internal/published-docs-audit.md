# Published documentation code audit

Reviewed 2026-08-19 against the branch implementation.

## Page-by-page result

| Page | Code checked | Result |
| --- | --- | --- |
| root `README.md` | `install.sh`, `bin/glrs`, `package.json` | retained the terse landing page; corrected release channel and Bun/git requirements |
| `coding-agent/1-quickstart.md` | `ui/screen.ts`, `composer.ts`, first-party commands, CLI startup | corrected install link, command inventory, queue/interrupt keys, exit/resume behavior |
| `coding-agent/2-installation.md` | `docs-site/public/install.sh`, `bin/glrs`, `index.ts`, `package.json` | corrected `next` channel, Bun requirement, update behavior, uninstall commands, and artifact paths; removed nonexistent update/uninstall scripts |
| `coding-agent/3-customize/1-configuration.md` | `provider-registry/config.ts`, `writeconfig.ts`, reload host | aligned all three scopes, platform paths, precedence, aliases, additive lists, shorthand, writable section, and restart/reload boundary |
| `coding-agent/2-use/2-sessions.md` | `glrs-core/session.ts`, `/session`, compaction code, print host | added persistence/resume/storage/clear/compact details; clarified that print mode creates no session |
| `coding-agent/2-use/1-basics.md` | composer, mentions, queue, direct shell, guidance loader | aligned attachments, shell mode, queue keys, and actual rule-file walk |
| `coding-agent/2-use/4-providers.md` | `PROVIDERS`, `ALIASES`, `missingFor`, model provider settings | completed provider/alias lists and aligned environment/config fallbacks; documented doctor limitations |
| `coding-agent/2-use/3-models.md` | model resolution, metadata cache, request retry loop | aligned required selection, precedence, cache, provider settings, and three-attempt retry behavior |
| `coding-agent/4-reference/1-cli.md` | argument parser and print host | aligned every core command/alias, stream split, extension flags, precedence, and exit status |
| `coding-agent/3-customize/2-commands.md` | command parser, first-party commands, user commands, guidance loader | aligned expansion, search order, collision order, skill namespace, and actual rule paths |
| `coding-agent/3-customize/3-skills.md` | `skills.ts` | aligned all four roots, depth, validation, aliases, invocation, and model opt-out |
| `coding-agent/3-customize/4-extensions.md` | extension resolver, API, both hosts, registry, toolkit | aligned discovery, first-party roster, collisions, permissions, mode differences, hooks, rendering, and host capabilities |
| `coding-agent/2-use/5-tools.md` | builtins tools, toolkit wrapper, web/ask/configure extensions | added conditional tools and aligned timeout, paths, output cap, filters, and permissions |
| `coding-agent/4-reference/3-troubleshooting.md` | doctor, config diagnostics, extension resolver, stores | aligned diagnostics, precedence, reload behavior, cache/session paths, and permissions |
| `coding-agent/4-reference/2-terminal-setup.md` | OpenTUI setup, key normalization, color and selection code | aligned Windows remap, Alt conventions, color, OSC 52, and terminal-owned keys |
| `coding-agent/5-internals/1-philosophy.md` | prompt construction, extension seams, permission model | factual; shortened to the implementation's current constraints |
| `coding-agent/5-internals/2-architecture.md` | package boundaries, turn path, rendering, persistence | removed stale file map and replaced it with package/runtime boundaries that exist now |
| `coding-agent/5-internals/3-lifecycle.md` | `EventName`, payload/verdict types, TUI host, print host | contains every event exactly once, return behavior, four print-mode exclusions, and the current host ordering difference |

`features.md` was removed because it duplicated quickstart, basics, tools, and
configuration. `glossary.md` was removed because its short definitions added no
useful guidance beyond those pages.

## Published hierarchy

1. quickstart
2. installation
3. **use** — basics, sessions, models, model providers, tools
4. **customize** — configuration, commands, skills, extensions
5. **reference** — CLI, terminal setup, troubleshooting
6. **internals** — philosophy, architecture, lifecycle

`docs/published/coding-agent/index.md` supplies the label and optional entry
points; its parent directory supplies `/coding-agent/`. The build discovers and
builds every `docs/published/*/index.md` project independently, then generates
the root project list from those files.

Numeric file and directory prefixes preserve page order and are removed from
visible page/group titles by frontmatter and the document-groups plugin. Group
rows are labels, not pages or links.

## Drift found outside the prose

- bundled `/help` described `esc` as taking back a queued message. `esc` actually interrupts and holds the queue; `alt+up` takes one back. fixed in code.
- the generated Extension API referenced its former `Shipped` metadata type, `ExtensionChoice`, and its `WriteOutcome` dependency without exporting them from its entry point. all are now exported, removing TypeDoc's unresolved-reference warnings.
- the TUI fires `idle` before `turn_end`; print mode fires `turn_end` before `idle`. the lifecycle page now says so. these should probably be made consistent in code.
- `ProviderSpec` says an empty credential list delegates detection to the SDK, but Vertex and Bedrock list only a subset of credential-chain inputs. `doctor` can therefore warn while ADC, SSO, web identity, or instance credentials still work. the providers page now distinguishes doctor's recognized variables from SDK behavior.
- `setSessionName()` changes only the live session: `saveSession()` does not serialize `title`, and resume derives it from the latest user message. the generated API promise was narrowed in this audit; consider persisting the title or removing the setter.
- rule discovery still reads AmpCode-specific system/User paths (`/etc/ampcode`, `~/.config/amp`) and does not use the new User directory resolver. the docs now describe the code, but the path policy should be reconciled.

## Content that should be generated

### highest value

1. **slash commands** — export first-party command metadata from the builtins extension. use it for registration, `/help`, and the quickstart table. the stale `esc` help text found in this audit is the same class of drift.
2. **keys** — define one key/action manifest beside the composer dispatcher. use it for `/help`, quickstart, basics, and terminal setup. key behavior is currently split across `screen.ts`, `composer.ts`, and prose.
3. **tools** — export first-party tool metadata from builtins, web-fetch, ask-user, and `configure_extension`. generate tools and quickstart tables and keep availability predicates in the same records.
4. **providers and aliases** — `PROVIDERS` and `ALIASES` are already data. expose a serializable documentation view and render the provider table directly.
5. **config schema** — replace the hand-maintained `Config` type + `KNOWN` list + shape parser + documentation table with one schema/metadata source. generate keys, types, defaults, aliases, and merge behavior.

### next

6. **CLI** — represent core commands and flags as declarations consumed by parsing, usage output, and the CLI page. extension flags remain dynamic.
7. **lifecycle** — `EventName`, `EventPayload`, and `Verdict` already define the surface. generate the event table; retain prose only for ordering and comparisons. the existing test guards names, not payloads or returns.
8. **first-party extension roster** — export the private bundled roster and generate name/default/summary tables plus the model's availability copy.
9. **paths and stores** — expose config, cache, and session path descriptors so installation/configuration/troubleshooting do not restate platform rules.
10. **release channel/install commands** — derive `next`, package name, and package-manager snippets from package/release metadata. they currently live in `package.json`, install script, updater, README, and two pages.

### keep hand-written

- quickstart flow and examples
- basics and troubleshooting explanations
- philosophy
- architecture rationale
- extension recipes
- terminal-specific remediation

TUI component structure itself is not a good generated-doc target. its user-visible **keys, commands, statuses, and conditional tools** are.
