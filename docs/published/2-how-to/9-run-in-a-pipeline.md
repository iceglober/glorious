---
title: run in a pipeline
---

# run in a pipeline

`-p` runs one turn and exits: no TUI, no session file. everything after `-p` is the prompt, verbatim, so flags go before it.

```bash
glrs -p "count the TODOs in src/"
cat build.log | glrs -p "summarise the failures"
```

piped input joins the prompt, fenced as `<input>`.

## output

the answer goes to stdout. tool trail, retries and diagnostics go to stderr.

```bash
glrs -p "count the TODOs" > answer.txt        # answer alone
glrs -p "count the TODOs" 2>&1 | tee run.log  # answer with the trail
```

## exit code

`0` finished. `1` failed, was interrupted, or hit the step limit.

codes and flags: [cli](../9-reference/1-cli.md)

see also: [cli](../9-reference/1-cli.md)
