# taxonomy

The vocabulary of glrs. `docs/published/` uses these words and no synonyms.

Working material. The raw list it was derived from is at the bottom. Where the
code and this file disagree, it is marked, and the code is what changes.

## the shape

Six layers, plus two things that sit beside them rather than inside.

    1. install        the binary on your machine
    2. model          who answers, and what it costs
    3. session        the conversation, and what persists of it
    4. turn           one exchange inside a session
    5. tool           what reaches the machine
    6. instruction    what you teach it, without writing code
    7. extension      what you build, in TypeScript

    beside:  subcommand    deterministic work, no session
             self-authoring  glrs writing its own extension

A **turn** happens inside a **session**. A **session** runs in a **mode**.
Everything under **extension** is something an extension registers.

## 1. install

| term | means |
| --- | --- |
| **binary** | `glrs`, and `glorious`, the same executable under two names |
| **channel** | the npm dist-tag installed from. `next` today |
| **doctor** | the command that reports what *would* run, without running it |

The lifecycle is install, update, uninstall. Naming one implies the other two.

## 2. model

| term | means |
| --- | --- |
| **provider** | who serves the model. `anthropic`, `azure`, `ollama` |
| **model id** | `provider/model-id`. Always both halves; there is no default |
| **variant** | reasoning effort: `low`, `med`, `high`, `xhigh`, `max` |
| **default variant** | what a model uses when none is set. Usually `med` |
| **credential** | the environment variable a provider reads |
| **catalogue** | context window and prices, fetched from models.dev and cached |

Say **set a model**, not *name* or *choose*. Four places, nearest wins:
`--model`, `GLRS_MODEL`, project config, user config.

> **code gap.** `shaping.ts:25` declares `"minimal" | "low" | "medium" | "high"`.
> The canonical set above is what providers actually offer. The code needs
> `med` over `medium`, and needs `xhigh` and `max`. `g.setThinkingLevel(level)`
> takes a bare `string`, so it will not catch the mismatch.

## 3. session

| term | means |
| --- | --- |
| **session** | one conversation, with an id, stored as a JSON event log |
| **event** | one entry in that log: `user`, `assistant`, `tool`, `usage`, … |
| **transcript** | what you see on screen. The event log is what is stored |
| **resume** | reopening a session by id, or picking one from a list |
| **switch** | moving to another session without leaving glrs |
| **fork** | copying a session, whole or up to an event, into a new id |
| **context** | the information the model is working from right now: the system prompt, the conversation so far, and what rode along with this turn |
| **compaction** | replacing the older part of the context with a summary |

**Context** is the material, not a measurement. The status line shows how much of
the model's window that material currently fills; do not call that "the context".

**Clear** drops what the model replays and keeps the transcript. **Compact**
summarises it. Not synonyms.

## 4. turn

| term | means |
| --- | --- |
| **turn** | one exchange: your message, the model's work, its answer |
| **step** | one model call inside a turn. A turn with three tool calls has several |
| **follow-up** | a message queued to arrive after the turn drains. `enter` |
| **steering** | a message that joins the running turn at its next step. `alt+enter` |
| **queue** | where either waits. Two of them, delivered one at a time or all at once |
| **interrupt** | stopping the running turn, `esc` |

**Follow-up** and **steering** are the two queue kinds in the code. Not *inject*,
*interject* or *mid-turn message*.

## 5. tool

| term | means |
| --- | --- |
| **tool** | something the model can call: `read`, `edit`, `bash`, … |
| **withhold** | removing a tool from what the model sees, `tools.disable` |
| **timeout** | the deadline a tool runs under, `toolTimeoutMs` |

Every tool comes from an extension; the core registers none. **Withhold** a tool,
**disable** an extension. The two words are not interchangeable.

## 6. instruction

What you teach glrs without writing code.

| term | means | who acts |
| --- | --- | --- |
| **command** | a prompt you invoke with `/name` | you invoke it |
| **skill** | instructions the model loads when it judges them relevant | it chooses |
| **rules** | `AGENTS.md`, in the system prompt every turn | nobody; always on |

Commands come in three kinds, named by **how they are defined**, not by who
shipped them:

| kind | defined as |
| --- | --- |
| **native** | code, through `g.command()`. Ships with glrs, or comes from any extension |
| **markdown** | a `.md` file you write |
| **skill command** | `/skill:name`, which every skill answers to |

Not *built-in*. A user extension can define a native command, so origin is the
wrong axis.

## 7. extension

One noun. A TypeScript file that default-exports a function taking the glrs API.
The API is 54 members. Everything below is something an extension **registers**;
none is a separate concept.

| registers | means |
| --- | --- |
| **tool** | something the model can call |
| **command** | a native slash command |
| **subcommand** | a word on the `glrs` binary, `glrs wt …` |
| **hook** | a handler for a lifecycle **event** |
| **renderer** | how a tool call, a message or an entry is drawn |
| **widget** | takes over the composer and receives keys |
| **autocomplete** | a completion source in the composer |
| **status**, **footer**, **activity** | parts of the screen it can own |
| **prompt line** | a line added to the system prompt each turn |

**Bundled** extensions ship in the box; **disk** extensions are files in
`.glrs/extensions/`. Both are extensions.

Lifecycle events come in two shapes. Most report. Those named `before_*`, plus
`input`, `tool_call`, `tool_end`, `context` and `project_trust`, carry a
**verdict**: what a handler returns changes the outcome.

## beside the layers

### subcommand

`glrs wt list` runs deterministic work and exits. No session, no model, no
screen. It is not a mode and not a turn; it is a program that happens to live
behind the `glrs` binary. Ships with glrs or comes from an extension.

### self-authoring

glrs is given its own documentation in the system prompt and told to write an
extension when asked for a capability it lacks, rather than declining.

- **self-authoring**: the behaviour.
- **self-authored extension**: what it produces.
- "glrs can self-author an extension if new functionality is requested."

This is the most distinctive thing in the product. It belongs on the homepage,
not buried in the extension reference.

## cross-cutting

| term | means |
| --- | --- |
| **mode** | the surface a session runs on: `tui` or `print`. This is `g.mode` |
| **host** | the implementation behind a mode, and behind subcommands |
| **scope** | which config file a setting came from: Project-User, Project, User |

`g.mode` also returns `cli`, which is the subcommand host rather than a third
way to hold a session. Published docs say **two modes**, and name the
**subcommand host** separately.

**Host** is fine in published docs. The audience is technical.

## rules for the docs

1. One word per concept. The table above is the word.
2. Six layers plus two neighbours. Do not introduce a seventh layer.
3. Explain a term at first use on a page, then use it freely.
4. Prefer the code's word. Where this file and the code disagree, the
   disagreement is marked above and the code is what changes.

---

## raw list

Everything a user does or meets, simplest first. Kept so the derivation above
stays checkable.

- see what version you have, `glrs --version`
- install glrs
- update glrs
- uninstall glrs, and know what data that leaves behind
- check the whole setup resolves, `glrs doctor`
- read a diagnostic explaining why a setting did nothing
- get an API key from a provider
- learn what a model id looks like, `provider/model-id`
- set a model for one run, `--model`
- set a model for a shell, `GLRS_MODEL`
- set a model for a project, config
- set a model for every project, user config
- know which of those wins when two disagree
- set a variant, and know the model's default
- start a session
- type a message and get an answer
- watch it read, edit, and run things
- read the status line: model, context used, cost
- stop a turn that is going wrong
- clear the conversation and keep the transcript
- leave, and come back to the same session
- pick an old session from a list
- switch to another session without leaving
- reference one file with `@`
- explore an unfamiliar tree with `@` completion
- attach a whole directory's listing with `@`
- run a shell command inline with `!`
- queue a message while it is working
- steer a turn that is already running
- take back something you queued
- choose whether queued messages arrive one at a time or all at once
- watch the context fill and compact itself
- force a compaction early
- fork a session to try two directions
- switch models mid-session
- point at a local model server
- point at a corporate gateway
- ask glrs what it can do, and have it read its own docs to answer
- ask glrs why a setting is not working
- ask glrs for a capability it does not have, and have it self-author one
- have it verify what it built with `glrs -p`
- give it project rules in `AGENTS.md`
- write a slash command you invoke
- pass arguments to that command
- share a command across every project
- write a skill it chooses on its own
- write the description so it triggers at the right time
- narrow what a skill may touch
- turn off a tool you do not want it using
- turn off a whole extension
- turn on an extension that ships but is off
- let glrs record that choice in your config
- reload after editing a file, without restarting
- see what each extension contributed
- run one turn headless, `-p`
- send the answer to a file, keeping the tool trail separate
- read the exit code in a script
- run a subcommand that never opens a session, `glrs wt list`
- hit a tool timeout, or the step limit, and carry on
- recover when a provider rate-limits you
- write an extension: one TypeScript file, default-exporting a function
- have that extension register a tool
- have it register a native slash command
- have it register a subcommand on the `glrs` binary
- have it hook a lifecycle event
- return a verdict from a hook and change the outcome
- rewrite what the user typed before it is sent
- block a tool call before it runs
- rewrite a tool result before the model sees it
- change what is sent to the model for one call
- cancel a compaction, a fork or a session switch
- decide whether a project is trusted
- add a line to the system prompt each turn
- store your own data in the session
- draw your own widget in the composer
- add a completion source to the composer
- replace how a tool, a message or an entry renders
- add a status segment or own the activity row
- ship a skill inside an extension
- publish an extension for other people
- embed the core in your own program
