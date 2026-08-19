---
"@glrs-dev/glrs": minor
---

The core no longer knows what a question is.

`ask_user` was a built-in tool, and 234 lines of question widget lived in the
renderer to serve it. Both are gone. `ask_user` is a bundled extension now,
written against the extension API like anything else — delete it and the model
loses the ability to ask; write your own and it is not competing with anything
privileged.

`g.ask`, `g.ui.select`, `g.ui.confirm` and `g.ui.input` are replaced by one
primitive:

```ts
const held = g.ui.capture({
  render: (columns) => Line[],     // draw the composer area
  onKey: (key) => void,            // every keypress, until you close
});
```

Those helpers looked generic and were not. `g.ask` returned a **JSON string** —
because that is what a tool must return to a model — and `select`/`confirm`/
`input` worked by `JSON.parse`-ing it back out. `g.ui.input` faked free text by
offering a single option labelled "Type your answer as a note". The shape of a
model's tool result had leaked into the extension API and become its input
abstraction.

Now the host owns "you have the composer and the keys" and nothing else. The
bundled `ask-user` extension is a complete question widget — a cursor, several
questions in sequence, free-text notes, dismissal — built on `capture` alone,
and its answers reach the model as prose rather than JSON, because formatting
for a model is the tool's job.

Also: the guidance telling the model to use `ask_user` moved out of the core
system prompt into the extension. Removing the tool used to leave the model
instructed to use something that no longer existed.
