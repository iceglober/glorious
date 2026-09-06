---
title: sessions
---

# sessions

a session is one conversation. it has an id, and it is stored as a log of
events.

## on disk

`$XDG_DATA_HOME/glrs/sessions/<id>.json`, else `~/.local/share/glrs/sessions/`.
prompt history is `prompts.json` beside them.

```json
{
  "schema": 2,
  "id": "3f9a1c2b",
  "createdAt": "",
  "updatedAt": "",
  "cwd": "",
  "events": [],
  "contextTokens": 0
}
```

`.../glorious/sessions/` is read, never written. a session resumed from there is
saved to the new path.

## entries

a session is a log. each record in it is an entry. the extension API calls them
entries too (`g.appendEntry`, `g.entries`).

these are not [lifecycle events](./12-events.md), which are announcements an
extension hooks while glrs runs. entries are what is on disk.


| entry | recorded when |
| --- | --- |
| `user` | you send a message. carries `steer` when it joined a running turn |
| `assistant` | the model answers |
| `tool` | a tool runs. carries its input and result, so an extension can redraw it |
| `reasoning` | the model reasons, kept in full |
| `usage` | a model call reports tokens and cost |
| `turn` | a turn ends, carrying the raw messages |
| `notice`, `error` | glrs says something |
| `cleared`, `compacted` | the replay boundary moves |
| `custom` | an extension's own data. never sent to the model |

the file is written on `usage` and `turn`, at turn end, and at idle. a notice
reaches disk on the next of those.

## resume, switch, fork

| action | effect |
| --- | --- |
| `glrs --resume <id>` | reopen that session |
| `glrs --resume` | pick from a list, newest first |
| `/fork` | copy the whole session to a new id |
| `/fork 42` | copy the session up to entry 42 into a new id |

a fork leaves the original untouched. the copy is on disk immediately, so
`glrs --resume <new-id>` opens it.

## context

the context is what the model is working from: the system prompt, the
conversation so far, and what rode along with this turn. the status line shows
how much of the model's window it fills.

`/clear` drops what the model replays and keeps the transcript on screen.

## compaction

past 75% of the window the older part of the conversation is summarised and
replaced by one message. `compactAt` moves that fraction, and `0` turns it off
while leaving `/compact` working:

```json
{ "compactAt": 0.5 }
```

on a million-token model 75% is 787,500 tokens, which is both late and
expensive on every turn that reaches it. a smaller fraction is often the better
trade.

the window it plans against is the smaller of the model's and `compactWindow`,
256,000 by default. a million-token model is compacted as if it had 256k,
because every turn past there re-sends all of it at full price; a model whose
window the catalogue does not know is assumed to have 256k rather than never
being compacted. `providers.<id>.models.<id>.metadata.context` still wins.

`compactModel` names who writes the brief, as `provider/model-id`. the
session's own model when unset. summarising suits something cheaper and faster,
provided its window is at least `compactWindow`:

```json
{ "compactModel": "azure/gpt-5.4-nano" }
```

a turn that would pass the same line stops at its next step rather than taking
another, says `(compacting to make room: send "continue" to resume)`, and
compaction follows. before that, a turn could go from under the threshold to
past the window inside itself and be refused outright with `Your input exceeds
the context window of this model`: idle is too late to look, and the check
before a new message is too early.

the brief is written in the background, from a snapshot, while the session is
idle or while a turn is running: the check runs on every step, because an
agentic turn is where the context grows. a turn only appends, so the brief
lands once the turn does and nothing the turn added is lost. `esc` stops the
turn; a brief being written invisibly is left to finish.

## what a compaction replaced

the brief is lossy by design. the messages it replaced are written beside the
session, unchanged, one file per compaction:

```text
<data>/glrs/sessions/artifacts/<session id>/2026-09-06T14-02-11-000Z.md
```

```text
---
label: fixed three failing auth tests
createdAt: 2026-09-06T14:02:11.000Z
messages: 244
note:
---
[user]
the login redirect test is failing
[tool-call read]
{ "path": "src/auth/redirect.ts" }
[tool-result read]
export const redirect = (url) => url.split('?')[0];
…
```

the label is the first line of the brief. the `compaction-artifacts` extension
gives the agent `compaction_list`, `compaction_read`, `compaction_annotate` and
`compaction_delete` over them, and `/artifacts` lists them for you. the agent is
told they exist only once one does. disable the extension and the files still
land.



```text
<earlier-conversation>
…
</earlier-conversation>
```

a tool result separated from the call it answers is an invalid request, so the
cut walks back to the newest user message that still leaves about 20k tokens of
recent work. everything after it survives verbatim. everything before it is the
brief.

`/compact` forces it early. `/compact <instruction>` steers what the brief
keeps.

see also: [turns](./6-turns.md), [a turn](../3-explanation/2-a-turn.md), [resume and fork](../2-how-to/3-resume-and-fork.md)
