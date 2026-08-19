---
"@glrs-dev/glrs": minor
---

Add `$` extensions — named project scripts that run without calling the model.

A slash command always ends in a turn; `!` never does but has to be typed out in full. There was
no way for a project to name a deterministic action and reach it quickly. Neither the Agent
Skills spec nor Claude Code's slash commands cover this: both can run shell, but only ever to
build a prompt, so "run this, change local state, send nothing to the model" had nowhere to live.

An extension is a markdown file in `.glorious/extensions/<name>.md`, invoked by typing `$` and
completing the name. Frontmatter holds the deterministic part, the body is an optional prompt:

```markdown
---
description: Reset to a clean main
run: |
  git checkout main
  git pull --ff-only
clear: true
---

The working tree was reset. Anything you knew about the previous branch is stale.
```

`run` always executes, with arguments passed as real positional parameters so `$fresh main` gives
the script `$1` — nothing is interpolated into the command text. With a body, a turn is sent once
the shell succeeds, carrying the script's stdout as fenced evidence; `run: git diff` plus "review
this" is a whole workflow in one file. Without a body no turn is produced at all, which is the
part nothing else offers. `clear` drops the conversation for a script that moves the ground the
model was standing on. A non-zero exit shows the output and stops: nothing sent, nothing cleared.

Extensions are user-invoked only — the model cannot decide to reset your working tree. They are
discovered like commands (project directories shadow personal ones), listed in `/help`, and
reloaded by `/skills`. Autocomplete is now sigil-aware, so `/` and `$` each complete their own
namespace, and `$` is withheld in shell mode where `$VAR` is a real variable.
