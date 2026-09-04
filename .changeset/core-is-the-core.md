---
"@glrs-dev/glrs": minor
---

Make `glrs-core` the core the coding agent runs on.

`glrs-core` was 1,235 lines, 310 of them type declarations and two exported functions, while the turn loop, tool contracts and extension registry it claimed to own all lived in `glrs-coding-agent`. The boundary was real as a rule and guarded almost nothing.

The runtime moved: `agent`, `chat`, `extension-api`, `toolkit`, `skills`, `commands`, `usercommands` and `queue`, plus the published entry points `sdk.ts` and `public-extension-api.ts`. **4,276 / 4,202** now, against 1,235 / 7,122.

**Core has no identity.** `You are glrs, a coding agent` is `identity.ts` in the product, and `createAgent` takes `instructions: () => string` rather than reaching for a system prompt. A different product on the same core is a different identity, not a fork. `environmentPrompt` and `skillsPrompt` stayed in core: they say where the agent is, not what it is for.

**The extension roster is a product decision.** Discovery, shadowing and failure isolation are core and take the roster as data. The five bundled imports stay in the product, which binds them and re-exports, so no call site changed.

**Display primitives are core.** `Line`, `clip`, `width`, `clean`, `errorText`, `describeThrown` — none touch a terminal, and the runtime needs them to describe output without knowing how it is drawn. The escape sequences were always in `ui/screen.ts`. The block builders that assemble a transcript stayed in the product.

`check-boundaries.ts` now allows core to import `glrs-providers` and still forbids it importing the product. The runtime resolves a model to call, and a provider-neutral port with one implementation would be a layer that costs a file and decides nothing.

No behaviour changes. 786 tests pass.
