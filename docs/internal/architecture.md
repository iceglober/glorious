# Architecture

Three packages. The rule is one-way: the product depends on the core, never the
reverse. `scripts/check-boundaries.ts` enforces it.

```text
glrs-coding-agent        the product: hosts, terminal, coding identity
        │ depends on
        ▼
     glrs-core           the runtime: turns, sessions, tools, extensions
        │ depends on
        ▼
   glrs-providers        model resolution, credentials, catalogue
```

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

## display primitives are core

`Line`, `Span`, `Tone`, `clip`, `width`, `clean`, `errorText`, `describeThrown`.
None of them touch a terminal, and the mechanism needs them to describe output
without knowing how it is drawn. The block builders that assemble a transcript
are the product's.
