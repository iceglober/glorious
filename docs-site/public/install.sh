#!/usr/bin/env bash
set -euo pipefail

# glrs bootstrap — installs bun, offers gh, then @glrs-dev/glrs
# usage: curl -fsSL https://glrs.dev/install.sh | bash

RED='\033[0;31m'
BOLD='\033[1m'
DIM='\033[2m'
RESET='\033[0m'

log()   { printf "${BOLD}glrs${RESET} %s\n" "$*"; }
ok()    { printf "${BOLD}glrs${RESET} ✓ %s\n" "$*"; }
warn()  { printf "${BOLD}glrs${RESET} ${RED}!${RESET} %s\n" "$*"; }
dim()   { printf "${DIM}     %s${RESET}\n" "$*"; }

confirm() {
  printf "${BOLD}glrs${RESET} %s [y/N] " "$1"
  read -r ans
  case "$ans" in
    [yY]|[yY][eE][sS]) return 0 ;;
    *) return 1 ;;
  esac
}

# ── bun ────────────────────────────────────────────────────────────

if command -v bun &>/dev/null; then
  ok "bun $(bun --version)"
else
  warn "bun not found"
  if confirm "Install bun?"; then
    curl -fsSL https://bun.sh/install | bash
    export BUN_INSTALL="$HOME/.bun"
    export PATH="$BUN_INSTALL/bin:$PATH"
    if command -v bun &>/dev/null; then
      ok "bun $(bun --version) installed"
    else
      warn "bun installed but not on PATH — restart your shell and re-run this script"
      exit 1
    fi
  else
    warn "bun is required — install from https://bun.sh"
    exit 1
  fi
fi

# ── git ────────────────────────────────────────────────────────────

if command -v git &>/dev/null; then
  ok "git $(git --version | awk '{print $3}')"
else
  warn "git not found — install git and re-run this script"
  exit 1
fi

# ── gh (github cli, optional) ─────────────────────────────────────

if command -v gh &>/dev/null; then
  ok "gh $(gh --version | head -1 | awk '{print $3}')"
else
  dim "gh (GitHub CLI) not found — optional; glrs works without it, but GitHub tasks are smoother with it"
fi

# ── @glrs-dev/glrs ─────────────────────────────────────────────

log "installing @glrs-dev/glrs (next channel)..."
bun add --global @glrs-dev/glrs@next

if command -v glrs &>/dev/null; then
  ok "glrs $(glrs --version 2>/dev/null || echo 'installed')"
else
  warn "glrs installed but not on PATH — check your bun global bin directory"
  dim "try: bun pm bin -g"
  exit 1
fi

log ""
ok "done. set your model key, then run 'glrs' in any git repo:"
dim "export AZURE_OPENAI_API_KEY=..."
dim "export AZURE_RESOURCE_NAME=..."
dim "glrs"
