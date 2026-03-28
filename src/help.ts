export const HELP_TEXT = `
wtm - worktree manager for regular (non-bare) git repositories

Works in any cloned repo. No bare-repo conversion needed.
Worktrees are created as sibling directories: ../<repo>-wt-<name>
Override the location by setting the WTM_DIR environment variable.

USAGE
  wtm <command> [arguments] [flags]

COMMANDS
  create <name> [--from <branch>]
      Create a new worktree with a new branch based on <branch>.
      Fetches the latest from origin, creates the worktree, sets up
      upstream tracking, runs the post_create hook, then spawns an
      interactive shell inside the worktree (exit the shell to return).
      If --from is omitted, defaults to the repo's main branch.

      Examples:
        wtm create feature-auth              # branch from default (main/master)
        wtm create feature-auth --from dev   # branch from dev

  checkout <branch>
      Create a worktree from an existing remote branch.
      Fetches the branch from origin and creates a local tracking worktree.
      If the worktree already exists, prints its path and exits.
      Does NOT spawn a shell (use \`cd\` to enter it).

      Examples:
        wtm checkout fix/login-bug
        wtm checkout release/2.0

  list
      Print a table of all worktrees with their name, branch, and commit.
      The main worktree is marked with (main). Aliases: ls

      Example output:
        NAME                  BRANCH          COMMIT
        my-repo (main)        main            abc1234
        my-repo-wt-feature    feature-auth    def5678

  delete <name> [--force]
      Remove a worktree and delete its local branch.
      Fails if the worktree has uncommitted changes unless --force is set.
      Aliases: rm

      Examples:
        wtm delete feature-auth
        wtm delete feature-auth --force

  cleanup [--base <branch>] [--dry-run] [--yes]
      Find and delete worktrees that are safe to remove. A worktree is a
      candidate for cleanup when ALL of these are true:
        1. Its branch is merged into the base branch, OR its remote branch
           has been deleted.
        2. It has no uncommitted changes (staged, unstaged, or untracked).
        3. It has no local commits not reachable from origin/<base>.

      Protected branches are never offered for cleanup:
        main, master, next, prerelease

      Flags:
        --base <branch>   Base branch to check merges against (default: auto-detect)
        --dry-run         List candidates without deleting anything
        --yes, -y         Delete all candidates without prompting

      Examples:
        wtm cleanup --dry-run          # preview what would be deleted
        wtm cleanup --yes              # delete all safe-to-remove worktrees
        wtm cleanup --base develop     # check against develop instead of main

  start-work
      Launch the work management TUI. Manage your backlog, run parallel
      Claude Code sessions, and ship PRs — all from one interface.

      Data lives in .wtm/backlog.json. A spec (.wtm/spec.md) is auto-
      generated from the backlog on every change.

      TUI keybindings:
        [tab]    Switch between backlog and sessions views
        [a]      Add a new task
        [e]      Edit focused task
        [d]      Delete focused task
        [S]      Auto-start the highest-priority pending task
        [J/K]    Reorder tasks (move up/down)
        [enter]  Start focused task (creates worktree + Claude session)
        [r]      Refresh (pull main, check PR status)
        [q]      Quit

  init-hooks
      Create a .wtm/hooks/ directory in the repo root with a post_create
      hook template. The hook runs after every \`wtm create\` and
      \`wtm checkout\`. Edit it to install deps, copy .env, etc.

      Hook environment variables:
        WORKTREE_DIR   - absolute path to the new worktree
        WORKTREE_NAME  - name of the worktree / branch
        BASE_BRANCH    - branch it was created from
        REPO_ROOT      - absolute path to the main repository

  install-skills [--force]
      Install spec-workflow skills as Claude Code slash commands in the
      current repo. Writes to .claude/commands/s/ so they appear as
      /s:think, /s:work, /s:fix, /s:ship, etc.

      Included skills:
        think        Product strategy session before building
        todos        Generate todos from a spec file
        work         Implement a section of the todos
        fix          Fix issues, update spec if behavior changes
        update       Apply a spec change, sync todos
        investigate  Root-cause debugging with spec awareness
        qa           QA the diff against spec acceptance criteria
        review       Pre-landing code review with spec compliance
        ship         Typecheck → review → commit → push → PR

      Skips existing files by default. Use --force to overwrite.
      Skills expect a .spec.json at repo root and docs/spec/ + docs/todos/.

  upgrade
      Check for and install the latest version of wtm. Uses the gh CLI
      for authentication (required for private repos), or falls back to
      the GitHub API with GITHUB_TOKEN.

      Examples:
        wtm upgrade                    # update to latest release
        GITHUB_TOKEN=xxx wtm upgrade   # without gh CLI

FLAGS
  --version, -V    Print the version number and exit
  --help, -h       Show this help text

ENVIRONMENT VARIABLES
  WTM_DIR     Override worktree storage directory. When set, worktrees are
              created at WTM_DIR/<name> instead of ../<repo>-wt-<name>.

WORKTREE LAYOUT
  Given a repo at ~/repos/my-app:

    Default (no WTM_DIR):
      ~/repos/my-app/                  <- main worktree
      ~/repos/my-app-wt-feature/       <- wtm create feature
      ~/repos/my-app-wt-bugfix/        <- wtm create bugfix

    With WTM_DIR=~/worktrees:
      ~/repos/my-app/                  <- main worktree
      ~/worktrees/feature/             <- wtm create feature
      ~/worktrees/bugfix/              <- wtm create bugfix
`.trimStart();
