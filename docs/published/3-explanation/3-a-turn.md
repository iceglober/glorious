---
title: a turn
---

# a turn

a turn is a loop: send the conversation, read the stream, run the tools the model called, send again. one pass is a step. the turn ends when the model calls no tool and has nothing left to say. a hundred steps is the ceiling, and reaching it stops the turn and asks you to send `continue`.

## what is sent

```text
instructions   the system prompt, byte-identical every turn
history        every earlier message, unchanged
new message    environment · skills · extensions · what you typed
```

nothing volatile is in the system prompt. the date, the git branch, the skills catalogue and what extensions contribute ride in the per-turn message. a system prompt that varied would move the cached prefix, and every turn would pay full price for the whole conversation.

## the breakpoint

OpenAI and Google cache a prefix unasked. Anthropic and Bedrock cache only what is marked, so glrs marks the second-to-last message: the newest point that will still be there next turn.

the mark therefore advances each turn. these providers match on prefix, so a longer conversation starting with the cached one extends the cache instead of replacing it.

## steering and follow-up

steering appends to the messages at the next step boundary of the running turn. the model reads it before it chooses its next action, and the prefix ahead of it is untouched, so it costs the tokens of what was said and nothing more.

a follow-up is its own turn, delivered once the agent has run out of work, so it cannot change what the running turn does. steering is the deliberate act, so it is the one that carries a modifier ([keys](../9-reference/2-keys.md)).

steering that arrives too late to join the turn becomes a follow-up, ahead of the ones already waiting.

## a stream that dies

three layers, innermost first:

1. fetch retries a connection that failed while the request was going out. deadlines 30, 10, 10 minutes.
2. the model client retries a refused request, five times.
3. the turn re-sends the whole stream, three times.

the third exists because the first two cannot see a mid-response drop: fetch resolved long ago and the body is still being read. re-sending is safe only while the attempt is unobservable: no text, no reasoning, no tool call. once anything has been produced the failure surfaces instead.

## compaction

past 75% of the context window the older part of the conversation is summarised and replaced by one message:

```text
<earlier-conversation>
…
</earlier-conversation>
```

a tool result separated from the call it answers is an invalid request, so the cut walks back to the newest user message that still leaves about 20k tokens of recent work. everything after it survives verbatim. everything before it is the brief.

see also: [events](../9-reference/8-events.md), [models](../9-reference/4-models.md)
