# wtm

Worktree manager for git. Work on multiple branches at the same time without stashing or switching.

wtm creates git worktrees as sibling directories next to your repo. Each worktree is an independent checkout — its own branch, its own working tree, its own terminal. No bare-repo setup needed.

## Install

Requires [Node.js](https://nodejs.org) 20+ and the [GitHub CLI](https://cli.github.com).

```bash
bash <(gh api repos/iceglober/wtm/contents/install.sh --jq .content | base64 -d)
```

Update to the latest version at any time:

```bash
wtm upgrade
```

## Quick start

```bash
# Create a worktree for a new branch (branches from main by default)
wtm create feature-auth

# You're now in a shell inside ~/repos/my-app-wt-feature-auth/
# It's a full copy of your repo on its own branch. Work here, commit here.
# Type `exit` to return to your main worktree.

# See all your worktrees
wtm list

# Done with a branch? Delete the worktree
wtm delete feature-auth

# Clean up all merged/stale worktrees at once
wtm cleanup
```

## Commands

| Command | What it does |
|---------|-------------|
| `wtm create <name>` | New worktree + branch, opens a shell inside it |
| `wtm checkout <branch>` | Worktree from an existing remote branch |
| `wtm list` | Table of all worktrees |
| `wtm delete <name>` | Remove a worktree and its local branch |
| `wtm cleanup` | Delete worktrees for merged/deleted branches |
| `wtm start-work` | TUI for managing a backlog + Claude Code sessions |
| `wtm init-hooks` | Create a post-create hook template |
| `wtm install-skills` | Install spec-workflow Claude Code slash commands |
| `wtm upgrade` | Update wtm to the latest release |

Run `wtm --help` for full documentation on each command.

## How it works

Given a repo at `~/repos/my-app`:

```
~/repos/my-app/                  <- your main worktree (unchanged)
~/repos/my-app-wt-feature-auth/  <- wtm create feature-auth
~/repos/my-app-wt-bugfix/        <- wtm create bugfix
```

Each worktree shares the same `.git` — commits, stash, and reflog are all shared. But each has its own working directory and branch.

Set `WTM_DIR` to put worktrees somewhere else:

```bash
export WTM_DIR=~/worktrees
wtm create feature-auth  # creates ~/worktrees/feature-auth/
```

## Hooks

Run `wtm init-hooks` to create a `.wtm/hooks/post_create` script. It runs after every `wtm create` and `wtm checkout` — use it to install deps, copy `.env`, or anything else a new worktree needs.

```bash
#!/usr/bin/env bash
# .wtm/hooks/post_create
cp "$REPO_ROOT/.env" "$WORKTREE_DIR/.env"
cd "$WORKTREE_DIR" && pnpm install
```

## Spec workflow skills

wtm ships with a set of Claude Code slash commands for spec-driven development. Install them in any repo:

```bash
wtm install-skills
```

This writes 9 skills to `.claude/commands/s/`:

- `/s:think` — product strategy session before building
- `/s:todos` — generate implementation checklist from a spec
- `/s:work` — implement a section of the todos
- `/s:fix` — fix issues, update spec if behavior changes
- `/s:update` — apply a spec change, sync todos
- `/s:investigate` — root-cause debugging
- `/s:qa` — QA the diff against spec acceptance criteria
- `/s:review` — pre-landing code review
- `/s:ship` — typecheck, review, commit, push, PR

Skills expect a `.spec.json` at repo root pointing to your spec and todos files. See `wtm install-skills` output for setup instructions.

## License

MIT
