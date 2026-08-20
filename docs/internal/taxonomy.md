# taxonomy

The vocabulary of glrs, and the shape of it. Every term here is one the code
already uses; none are invented for the documentation. `docs/published/` should
use these words and no synonyms.

Working material. The raw list this was derived from is at the bottom.

## the shape

Seven layers. Each is a thing a user holds in their head at once, and they nest:
a **turn** happens inside a **session**, a **session** runs in a **mode**, and
everything below **extension** is something an extension registers.

    1. install        the binary on your machine
    2. model          who answers, and what it costs
    3. session        the conversation, and what persists of it
    4. turn           one exchange inside a session
    5. tool           what reaches the machine
    6. instruction    what you teach it, without writing code
    7. extension      what you build, in TypeScript

Reference pages map one to one onto these. Nothing in the docs should introduce
an eighth.

## 1. install

| term        | means                                                         |
| ----------- | ------------------------------------------------------------- |
| **binary**  | `glrs`, and `glorious`, the same executable under two names   |
| **channel** | the npm dist-tag installed from. `next` today                 |
| **update**  | reinstalling the channel's latest, `glrs update`              |
| **doctor**  | the command that reports what _would_ run, without running it |

The lifecycle is install, update, uninstall. Naming one implies the other two.

## 2. model

| term           | means                                                         |
| -------------- | ------------------------------------------------------------- |
| **provider**   | who serves the model. `anthropic`, `azure`, `ollama`          |
| **model id**   | `provider/model-id`. Always both halves; there is no default  |
| **variant**    | reasoning effort: `minimal`, `low`, `medium`, `high`          |
| **credential** | the environment variable a provider reads                     |
| **catalogue**  | context window and prices, fetched from models.dev and cached |

Say **set a model**, not _name_ or _choose_. It is set in one of four places and
the nearest wins: `--model`, `GLRS_MODEL`, project config, user config.

## 3. session

| term           | means                                                          |
| -------------- | -------------------------------------------------------------- |
| **session**    | one conversation, with an id, stored as a JSON event log       |
| **event**      | one entry in that log: `user`, `assistant`, `tool`, `usage`, … |
| **transcript** | what you see on screen. The event log is what is stored        |
| **resume**     | reopening a session by id, or picking one from a list          |
| **fork**       | copying a session, whole or up to an event, into a new id      |
| **context**    | how much of the model's window the conversation currently uses |
| **compaction** | replacing the older part of the conversation with a summary    |

**Clear** drops what the model replays and keeps the transcript. **Compact**
summarises it. They are not synonyms.

## 4. turn

| term          | means                                                                   |
| ------------- | ----------------------------------------------------------------------- |
| **turn**      | one exchange: your message, the model's work, its answer                |
| **step**      | one model call inside a turn. A turn with three tool calls has several  |
| **follow-up** | a message queued to arrive after the turn drains. `enter`               |
| **steering**  | a message that joins the running turn at its next step. `alt+enter`     |
| **queue**     | where either waits. Two of them, delivered one at a time or all at once |
| **interrupt** | stopping the running turn, `esc`                                        |

**Follow-up** and **steering** are the two queue kinds in the code. Do not write
_inject_, _interject_ or _mid-turn message_.

## 5. tool

| term         | means                                                            |
| ------------ | ---------------------------------------------------------------- |
| **tool**     | something the model can call: `read`, `edit`, `bash`, …          |
| **builtin**  | a tool from the `builtins` extension. Not "built in" to the core |
| **withhold** | removing a tool from what the model sees, `tools.disable`        |
| **timeout**  | the deadline a tool runs under, `toolTimeoutMs`                  |

Every tool comes from an extension. The core registers none. Say **withhold**,
not _block_ or _disable_, for keeping a tool from the model: disabling is what
you do to an extension.

## 6. instruction

What you teach glrs without writing code. Three kinds, one discovery rule.

| term        | means                                                     | you             |
| ----------- | --------------------------------------------------------- | --------------- |
| **command** | a prompt you invoke with `/name`                          | invoke it       |
| **skill**   | instructions the model loads when it judges them relevant | it chooses      |
| **rules**   | `AGENTS.md`, in the system prompt every turn              | never invoke it |

Commands come in three kinds: **built-in** (ship with glrs), **markdown**
(a file you write), and **skill commands** (`/skill:name`, every skill has one).

The distinction that matters: you invoke a command, the model activates a skill,
and rules apply unasked.

## 7. extension

One noun. A TypeScript file that default-exports a function taking the glrs API.
Everything below is something one **registers**; none is a separate concept.

| registers                            | means                                       |
| ------------------------------------ | ------------------------------------------- |
| **tool**                             | something the model can call                |
| **command**                          | a slash command                             |
| **subcommand**                       | a word on the `glrs` binary, `glrs wt …`    |
| **hook**                             | a handler for a lifecycle **event**         |
| **renderer**                         | how a tool's call and result are drawn      |
| **widget**                           | takes over the composer and receives keys   |
| **status**, **footer**, **activity** | parts of the screen it can own              |
| **prompt line**                      | a line added to the system prompt each turn |

**Bundled** extensions ship in the box. **Disk** extensions are files you drop in
`.glrs/extensions/`. Both are extensions; the word does not change.

## cross-cutting

| term      | means                                                                   |
| --------- | ----------------------------------------------------------------------- |
| **mode**  | the surface glrs is running as: `tui`, `print`, `cli`. This is `g.mode` |
| **scope** | which config file a setting came from: Project-User, Project, User      |
| **host**  | the implementation behind a mode. Internal. Not for published docs      |

Say **mode** in published docs. **Host** is a word for the codebase.

## the thing that has no name yet

glrs is given its own documentation in the system prompt, and told to write an
extension when asked for a capability it lacks, rather than declining. That is
the most distinctive behaviour in the product and no term covers it.

Candidates: **self-extension**, **extending itself**, **ask it to build it**.
Undecided; pick one before writing the pages.

## rules for the docs

1. One word per concept. The table above is the word.
2. Never introduce a layer. Seven, and reference pages map onto them.
3. Explain a term at first use on a page, then use it freely.
4. Prefer the code's own word. If the code and the docs disagree, that is a bug
   in one of them, so fix it rather than translate.

---

## raw list

Everything a user does or meets, simplest first. The taxonomy above is derived
from this; kept so the derivation stays checkable.

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
- start a session
- type a message and get an answer
- watch it read, edit, and run things
- read the status line: model, context used, cost
- stop a turn that is going wrong
- clear the conversation and keep the transcript
- leave, and come back to the same session
- pick an old session from a list
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
- ask glrs for a capability it does not have, and have it build one
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
- hit a tool timeout, or the step limit, and carry on
- recover when a provider rate-limits you
- write an extension: one TypeScript file, default-exporting a function
- have that extension register a tool
- have it register a slash command
- have it register a subcommand on the `glrs` binary
- have it hook a lifecycle event
- rewrite what the user typed before it is sent
- block a tool call before it runs
- rewrite a tool result before the model sees it
- change what is sent to the model for one call
- add a line to the system prompt each turn
- store your own data in the session
- draw your own widget in the composer
- replace how a tool renders
- add a status segment or own the activity row
- ship a skill inside an extension
- publish an extension for other people
- embed the core in your own program
