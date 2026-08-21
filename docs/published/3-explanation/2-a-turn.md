---
title: a turn
---

# a turn

a turn is one exchange: your message, the model's work, its answer. a
step is one model call inside it. a turn with three tool calls takes several
steps.

send the conversation, read the stream, run the tools the model called, send
again. the turn ends when the model calls no tool and has nothing left to say.
a hundred steps is the ceiling.

## what is sent

| part | contents | changes |
| --- | --- | --- |
| **instructions** | the system prompt | never, byte for byte |
| **history** | every earlier message | only by appending |
| **new message** | environment, skills catalogue, extension lines, what you typed | every turn |

nothing volatile is in the system prompt. the date, the git branch and the
skills catalogue ride in the per-turn message instead. a system prompt that
varied would move the cached prefix, and every turn would pay full price for the
whole conversation.

## caching

a provider charges less for a prefix it has seen. that is why history is only
ever appended to, and why steering joins at a step boundary rather than being
inserted earlier.

OpenAI and Google cache a prefix without being asked. Anthropic and Bedrock
cache only what is marked, so glrs marks the second-to-last message: the newest
point that will still be there next turn. the mark advances every turn, which
extends the cached prefix rather than replacing it.

## steering and follow-up

| | joins | costs |
| --- | --- | --- |
| **steering** | the running turn, at its next step | the tokens of what was said |
| **follow-up** | its own turn, once the agent runs out of work | a new turn |

steering is the deliberate act, so it carries the modifier. steering that
arrives too late to join becomes a follow-up, ahead of the ones already waiting.

## when a stream dies

three layers, innermost first:

1. **fetch** retries a connection that failed while the request was going out.
2. **the model client** retries a refused request, five times.
3. **the turn** re-sends the whole stream, three times.

the third exists because the first two cannot see a mid-response drop: fetch
resolved long ago and the body is still being read.

re-sending is safe only while the attempt is unobservable, meaning no text, no
reasoning and no tool call has been produced. once anything has, the failure
surfaces instead of being retried.

## when the context fills

the context cannot grow forever, so past a threshold the older part is replaced
by a summary. the cut lands on a user message, because a tool result separated
from the call it answers is an invalid request.

thresholds and what survives: [sessions](../9-reference/5-sessions.md).

see also: [turns](../9-reference/6-turns.md), [events](../9-reference/12-events.md), [models](../9-reference/4-models.md)
