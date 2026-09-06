# Architecture

Three packages. The rule is one-way: the product depends on the core, never the
reverse. `scripts/check-boundaries.ts` enforces it.

```text
glrs-coding-agent   4,202   argv cli composer direct-shell extensions identity
        │                   index mentions print render writeconfig, and ui/
        │ depends on
        ▼
     glrs-core      4,276   agent chat commands display events extension-api
        │                   extensions guidance index preamble public-extension-api
        │                   queue sdk session shell skills toolkit usercommands
        │ depends on
        ▼
   glrs-providers   1,726   config models providers shaping
```

Core reaching providers is deliberate. The runtime resolves a model to call, and
a provider-neutral port with one implementation would be a layer that costs a
file and decides nothing.

## what makes something core

Three questions. Three no's and it belongs in core.

- does it need a terminal?
- does it assume the work is coding?
- does it name which extensions ship?

## core has no identity

`systemPrompt` is not in core. The product owns the identity, and core is handed
one:

```ts
createAgent({ model, systemPromptOverride: () => identity(), ... })
```

That is what makes a different product possible on the same runtime. A project
manager agent is a different identity and a different roster, not a fork.

`environmentPrompt` (os, date, cwd, git) and `skillsPrompt` stay in core: they
describe where the agent is, not what it is for.

## the roster is a product decision

Discovery, shadowing and failure isolation are core. Which five extensions ship
is not, so the hard-coded imports live in the product.

## the host port

Core defines `ExtensionHost`. A product implements it. Three do today: the TUI
(`index.ts`), headless (`print.ts`) and subcommands (`cli.ts`). A port with three
implementations is why the boundary is worth enforcing.

`sdk.ts` and `public-extension-api.ts` are core's, because they are the published
surface of the runtime rather than of this product. They are what
`package.json` `exports` and TypeDoc point at.

## display primitives are core

`Line`, `Span`, `Tone`, `clip`, `width`, `clean`, `errorText`, `describeThrown`.
None of them touch a terminal, and the mechanism needs them to describe output
without knowing how it is drawn. The block builders that assemble a transcript
are the product's.
