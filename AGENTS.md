# working in this repository

Rules for anyone writing here, human or agent. They apply to code comments,
commit messages, changesets, pull requests, documentation, and chat.

## examples over explanations

Show the thing. Explain only what the example cannot.

Prefer:

```json
{ "model": "anthropic/claude-opus-5", "variant": "high" }
```

Over: "the model field accepts a provider-qualified identifier, and the variant
field accepts a reasoning effort level."

A reader who can copy your example is finished. A reader who has to reconstruct
one from your description is still working.

This holds in prose too. Instead of "argv used to be parsed positionally, which
caused problems", write:

```
glrs --model -p hi     # set the model to "-p", then ran headless anyway
```

The failure fits in one line and nobody has to imagine it.

When both are needed, the example goes first and the explanation says only what
the example leaves ambiguous.

## no em-dashes

Not in any communication. Not in code comments, commit messages, changesets,
pull requests, documentation, or chat.

Use a comma when the clause is parenthetical:

> the plan is inert, so `glrs doctor` runs no extension code

Use a colon when what follows explains what came before:

> one reason: the value was whatever token sat beside the flag

Use a full stop when the clause can stand alone:

> the guess and the misconfiguration compounded. both are gone

Use parentheses when the aside is genuinely an aside:

> the fallback branch (shipped via root `files`) is the live one

An em-dash is usually one of those four wearing a costume. Pick the one you
meant.

## terse, not performative

Say what is needed in as few words as possible.

No slogans, no sayings, no humour, no marketing, and no aphorisms. These are not
style choices, they are noise a reader has to skip.

An aphorism is a sentence that sounds like a conclusion and carries no fact.
They are the easiest thing to write and the hardest to act on:

> if `/help` or `bash` needed a private door, the claim would be decoration
> sessions are the only one you cannot get back
> steering is the deliberate act, so it carries the modifier

Each states nothing checkable. Replace with the fact underneath it, or delete:

> `/help` and `bash` are registered through `g.command` and `g.tool`, the same
> members an extension uses

Prefer:

> `tools.disable` withholds a tool from the model.

Over: "glrs gives you fine-grained control over exactly which tools the model
can reach for."

Avoid jargon. Where a term is unavoidable, define it once at first use, then use
it freely:

> the TUI (the full-screen terminal interface) redraws on a timer

Do not write a sentence whose job is to introduce the next sentence. Do not
restate a heading in the line beneath it. Do not close a section by summarising
it.

## progressive disclosure

Lead with the answer. Add detail in layers a reader can stop reading.

Structure heavy material so the first sentence is useful alone:

> **Azure drops `baseURL`.** Azure is the default provider, so
> `providers.azure.api` parses, passes `doctor`, and does nothing. One line.

Someone who reads only the bold text knows what broke. Someone who reads the
sentence knows why it matters. Someone who needs the fix reads on.

In practice:

- A table beats eight paragraphs when the reader is comparing things.
- Put the failure before the mechanism. What breaks, then why.
- Long lists get a summary line above them.
- If a section runs past a screen, it wanted a heading.

Do not bury the conclusion under the reasoning that produced it. The reasoning
is available to anyone who wants it, below.

## why these are here

This file is loaded into the model's system prompt as `<repo-rules>`, so glrs
follows them when it works on itself. `packages/glrs-core/src/guidance.ts` reads
`AGENTS.md`, `AGENT.md` and `CLAUDE.md` from every directory between the project
root and your home directory, nearest last.
