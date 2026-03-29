#!/usr/bin/env bash
# Install or update aflow — AI-native development workflow CLI.
#
# Usage (with gh CLI authenticated, works for private repos):
#   bash <(gh api repos/iceglober/aflow/contents/install.sh --jq .content | base64 -d)
#
# Usage (when repo is public):
#   curl -fsSL https://raw.githubusercontent.com/iceglober/aflow/main/install.sh | bash
#
# Usage (from local repo clone):
#   bash install.sh
set -euo pipefail

REPO="iceglober/aflow"
TAG_PREFIX="v"
BINARY_NAME="af"

# ── Colors ────────────────────────────────────────────────────────────
if [ -t 1 ]; then
  GREEN='\033[32m' CYAN='\033[36m' YELLOW='\033[33m' RED='\033[31m' RESET='\033[0m'
else
  GREEN='' CYAN='' YELLOW='' RED='' RESET=''
fi

info()  { echo -e "${CYAN}▸${RESET} $1"; }
ok()    { echo -e "${GREEN}✓${RESET} $1"; }
err()   { echo -e "${RED}error:${RESET} $1" >&2; }
warn()  { echo -e "${YELLOW}warning:${RESET} $1"; }

# ── Prerequisites ─────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  err "Node.js or Bun is required but neither was found on PATH"
  echo "  Install Node.js 20+ from https://nodejs.org"
  echo "  Or install Bun: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.version.slice(1).split('.')[0])")
if [ "$NODE_MAJOR" -lt 20 ]; then
  err "Node.js 20+ required, found $(node --version)"
  exit 1
fi

if ! command -v gh &>/dev/null; then
  err "The gh CLI is required (handles GitHub auth for private repos)"
  echo "  Install: https://cli.github.com"
  exit 1
fi

# Verify gh is authenticated (needed for private repos, optional for public)
if ! gh auth status &>/dev/null 2>&1; then
  warn "gh CLI is not authenticated — release downloads may fail for private repos"
  warn "  Run: gh auth login"
fi

# ── Find latest release ──────────────────────────────────────────────
info "checking latest version..."

RELEASE_JSON=$(gh release list -R "$REPO" --json tagName -L 50 2>/dev/null || echo "[]")
LATEST_TAG=$(echo "$RELEASE_JSON" | node -e "
  const data = JSON.parse(require('fs').readFileSync('/dev/stdin', 'utf-8'));
  const r = data.find(r => r.tagName.startsWith('${TAG_PREFIX}'));
  console.log(r ? r.tagName : '');
")

if [ -z "$LATEST_TAG" ]; then
  err "no aflow releases found in $REPO"
  echo "  Create a release first: git tag ${TAG_PREFIX}0.3.0 && git push origin --tags"
  exit 1
fi

VERSION="${LATEST_TAG#$TAG_PREFIX}"
info "latest version: ${VERSION}"

# ── Find install directory ────────────────────────────────────────────
find_install_dir() {
  # Check if af already exists somewhere on PATH
  local existing
  existing=$(command -v "$BINARY_NAME" 2>/dev/null || true)
  if [ -n "$existing" ]; then
    # Resolve symlinks to find the actual binary location
    local resolved
    resolved=$(readlink -f "$existing" 2>/dev/null || python3 -c "import os; print(os.path.realpath('$existing'))" 2>/dev/null || echo "$existing")
    echo "$(dirname "$resolved")"
    return
  fi

  # Standard locations
  for dir in "$HOME/.local/bin" "$HOME/bin"; do
    if [ -d "$dir" ] && echo "$PATH" | tr ':' '\n' | grep -qx "$dir"; then
      echo "$dir"
      return
    fi
  done

  # Fall back to creating ~/.local/bin
  mkdir -p "$HOME/.local/bin"
  echo "$HOME/.local/bin"
}

INSTALL_DIR=$(find_install_dir)
INSTALL_PATH="${INSTALL_DIR}/${BINARY_NAME}"

# ── Download ──────────────────────────────────────────────────────────
info "downloading af v${VERSION}..."

# Use gh CLI to download the release asset
TMP_PATH="${INSTALL_PATH}.tmp"
gh release download "$LATEST_TAG" -R "$REPO" -p "$BINARY_NAME" -O "$TMP_PATH" --clobber

chmod +x "$TMP_PATH"
mv "$TMP_PATH" "$INSTALL_PATH"

ok "af ${VERSION} installed at ${INSTALL_PATH}"

# ── PATH check ────────────────────────────────────────────────────────
if ! echo "$PATH" | tr ':' '\n' | grep -qx "$INSTALL_DIR"; then
  echo ""
  warn "$INSTALL_DIR is not on your PATH"
  echo "  Add this to your shell profile:"
  echo "    export PATH=\"${INSTALL_DIR}:\$PATH\""
  echo ""
fi

# ── Verify ────────────────────────────────────────────────────────────
"${INSTALL_PATH}" --version
