import { bold, dim, cyan } from "./lib/fmt.js";
import { VERSION } from "./lib/version.js";

export const HELP_TEXT = `
${bold("aflow")} ${dim(`v${VERSION}`)}
AI-native development workflow — worktrees, tasks, and Claude Code skills.

${bold("USAGE")}

  ${cyan("af")} <command> [arguments] [flags]

${bold("COMMANDS")}

  ${bold("Worktree management")} ${dim("(af wt ...)")}

  wt create <name> [--from <branch>]
      Create a new worktree with a fresh branch forked from <branch>
      (defaults to main/master). Opens a shell inside the worktree.

      Examples:
        af wt create feature-auth
        af wt create hotfix-login --from release/2.0

  wt checkout <branch>
      Create a worktree from an existing remote branch.

      Example:
        af wt checkout feature-payments

  wt list
      Show all worktrees with their branch and latest commit.

  wt delete <name> [--force]
      Remove a worktree and its local branch. Refuses if the worktree
      has uncommitted changes unless --force is passed.

  wt cleanup [--base <branch>] [--dry-run] [--yes]
      Delete worktrees whose branches are merged into <base> (default:
      auto-detected) or whose remote branch has been deleted. Skips
      worktrees with uncommitted changes or unpushed commits.

  ${bold("Workflow")}

  start
      Launch the interactive TUI — manage your backlog, start tasks,
      and run parallel Claude Code sessions.

  skills [--force] [--user]
      Install aflow workflow skills as Claude Code slash commands.

      By default, installs to .claude/commands/ in the current repo.
      With --user, installs to ~/.claude/commands/ (available globally).

      Engineering skills (task workflow):
        /think        Product strategy session before building
        /work         Implement the task's unchecked items
        /fix          Fix bugs, update task items if needed
        /investigate  Root-cause debugging
        /qa           QA the diff against acceptance criteria
        /review       Pre-landing code review
        /ship         Typecheck, review, commit, push, PR

      Product skills (research & spec pipeline):
        /prod:research  Multi-agent research orchestrator
        /prod:spec      Research to product spec
        /prod:enrich    Autonomous spec enrichment from codebase
        /prod:refine    Interactive spec refinement
        /prod:review    Spec gap analysis after refinement

  hooks
      Create .aflow/hooks/ with a post_create template. The hook runs
      after every \`af wt create\` or \`af wt checkout\`.

      Hook environment variables:
        WORKTREE_DIR   - absolute path to the new worktree
        WORKTREE_NAME  - name of the worktree / branch
        BASE_BRANCH    - branch it was created from
        REPO_ROOT      - absolute path to the main repository

  upgrade
      Check for a newer version and self-update.

${bold("FLAGS")}

  --version, -V    Print version
  --help, -h       Show this help

${bold("ENVIRONMENT")}

  AFLOW_DIR    Override where worktrees are stored. By default, worktrees
               are created as siblings of the repo:

                 repo/            <- your project
                 repo-wt-feature/ <- worktree

               With AFLOW_DIR set:

                 AFLOW_DIR/
                   feature/       <- worktree
                   bugfix/        <- worktree

${bold("WORKTREE LAYOUT")}

  Worktrees share the same .git object store, so branches, stashes, and
  history are shared. Each worktree has its own working tree and index.

  Default:
    ~/repos/myapp/               <- main repo
    ~/repos/myapp-wt-feature/    <- worktree

  With AFLOW_DIR=~/.worktrees:
    ~/.worktrees/feature/        <- worktree
`.trimStart();
