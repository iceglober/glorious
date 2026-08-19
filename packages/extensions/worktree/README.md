# @glrs-dev/glrs-ext-worktree

Git worktrees, as `glrs wt …` and as `/wt` inside a session, plus a skill that
teaches the agent when to reach for one.

`glrs wt doctor` is the reason this exists rather than being a wrapper around a
standalone tool: glrs records the directory every session ran in, so it can tell
you which worktrees somebody is still working in before you clean them up.
