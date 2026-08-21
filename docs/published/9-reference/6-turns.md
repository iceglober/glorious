---
title: turns
---

# turns

a turn is one exchange: your message, the model works, it answers. a step is one
model call inside it.

## queues

| queue | key | delivery | setting |
| --- | --- | --- | --- |
| follow-up | `enter` | its own turn once the current one finishes | `followUpMode` |
| steering | `alt+enter` | joins the running turn at its next step | `steeringMode` |

`one-at-a-time` (the default) delivers the oldest waiting message. `all` delivers everything waiting, joined by a blank line. with nothing running, `alt+enter` is just a turn.

## caching

a provider charges less for a prefix it has seen before, so the prefix is kept
stable: the system prompt is byte-identical every turn, and steering is appended
rather than inserted.

| provider | how |
| --- | --- |
| openai, google | caches a prefix without being asked |
| anthropic | needs a breakpoint written into the messages |
| amazon bedrock | needs a `cachePoint` |

the breakpoint goes on the second-to-last message, the newest point still
present next turn. it advances each turn, which extends the cached prefix rather
than replacing it.

why it is shaped that way: [a turn](../3-explanation/2-a-turn.md).

see also: [resume and fork](../2-how-to/3-resume-and-fork.md), [a turn](../3-explanation/2-a-turn.md)
