#!/usr/bin/env bash
#
# ctxflow multi-session demo
#
# Demonstrates how the SAME git user can run ctxflow in two different
# terminal sessions, each working on a separate task, with full
# context synchronization and conflict detection.
#
# Usage: ./demo/multi-session.sh
#

set -euo pipefail
cd "$(dirname "$0")/.."

# Colors
BOLD="\033[1m"
DIM="\033[2m"
GREEN="\033[32m"
YELLOW="\033[33m"
CYAN="\033[36m"
RED="\033[31m"
RESET="\033[0m"

banner() {
  echo
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${RESET}"
  echo -e "${BOLD}  $1${RESET}"
  echo -e "${BOLD}═══════════════════════════════════════════════════════════${RESET}"
  echo
}

step() {
  echo -e "${CYAN}▸ $1${RESET}"
}

info() {
  echo -e "${DIM}  $1${RESET}"
}

success() {
  echo -e "${GREEN}  ✓ $1${RESET}"
}

warn() {
  echo -e "${YELLOW}  ⚠ $1${RESET}"
}

pause() {
  echo
  echo -e "${DIM}  [press Enter to continue]${RESET}"
  read -r
}

# --- Setup ---

DEMO_DIR=$(mktemp -d)
REMOTE_DIR=$(mktemp -d)
trap 'rm -rf "$DEMO_DIR" "$REMOTE_DIR"' EXIT

banner "ctxflow Multi-Session Demo"
echo "  This demo shows how one developer can run two ctxflow sessions"
echo "  simultaneously — each with its own task, context, and conflict"
echo "  detection — all on the same machine and git identity."
pause

# Create a bare remote repo
step "Setting up demo git repos..."
git init --bare "$REMOTE_DIR" >/dev/null 2>&1
git init "$DEMO_DIR" >/dev/null 2>&1
cd "$DEMO_DIR"
git config user.name "stefano"
git config user.email "stefano@example.com"
git remote add origin "$REMOTE_DIR"
echo "# Demo Project" > README.md
git add README.md
git commit -m "init" >/dev/null 2>&1
git push -u origin main >/dev/null 2>&1
success "Git repo ready with remote"
echo

# --- Phase 1: Start two sessions ---

banner "Phase 1: Starting Two Sessions"

step "Terminal 1: ctxflow start \"Implement JWT authentication\""
export CTXFLOW_SESSION=""  # clear
OUTPUT1=$(cd "$DEMO_DIR" && node "$(cd "$(dirname "$0")/.."; pwd)/dist/index.js" start "Implement JWT authentication" 2>&1 || true)
SESSION1=$(echo "$OUTPUT1" | grep "Session:" | awk '{print $2}')
echo "$OUTPUT1"
echo
success "Session 1 created: $SESSION1"
pause

step "Terminal 2: ctxflow start \"Build admin dashboard\""
OUTPUT2=$(cd "$DEMO_DIR" && node "$(cd "$(dirname "$0")/.."; pwd)/dist/index.js" start "Build admin dashboard" 2>&1 || true)
SESSION2=$(echo "$OUTPUT2" | grep "Session:" | awk '{print $2}')
echo "$OUTPUT2"
echo
success "Session 2 created: $SESSION2"
pause

step "ctxflow (status) — see both tasks running:"
cd "$DEMO_DIR" && node "$(cd "$(dirname "$0")/.."; pwd)/dist/index.js" 2>&1 || true
pause

# --- Phase 2: Simulate file edits ---

banner "Phase 2: Independent File Edits"

step "Session 1 edits auth-related files..."
export CTXFLOW_SESSION="$SESSION1"
cd "$DEMO_DIR"
CTXFLOW_BIN="$(cd "$(dirname "$0")/.."; pwd)/dist/index.js"
node "$CTXFLOW_BIN" on-edit --file "src/auth/middleware.ts" 2>/dev/null || true
node "$CTXFLOW_BIN" on-edit --file "src/auth/tokens.ts" 2>/dev/null || true
node "$CTXFLOW_BIN" on-edit --file "src/types/auth.ts" 2>/dev/null || true
success "Session 1 touched: middleware.ts, tokens.ts, auth.ts"

step "Session 2 edits dashboard-related files..."
export CTXFLOW_SESSION="$SESSION2"
node "$CTXFLOW_BIN" on-edit --file "src/dashboard/layout.tsx" 2>/dev/null || true
node "$CTXFLOW_BIN" on-edit --file "src/dashboard/widgets.tsx" 2>/dev/null || true
node "$CTXFLOW_BIN" on-edit --file "src/api/dashboard.ts" 2>/dev/null || true
success "Session 2 touched: layout.tsx, widgets.tsx, dashboard.ts"
echo

# Write context notes
echo "Using jose library for JWT verification, REST middleware pattern" \
  > "$DEMO_DIR/.ctxflow/context/$SESSION1.md"
echo "React with TanStack Query, card-based dashboard layout" \
  > "$DEMO_DIR/.ctxflow/context/$SESSION2.md"
info "Both sessions wrote approach notes to their context files."
pause

# --- Phase 3: Context from each perspective ---

banner "Phase 3: Context Injection (what each LLM sees)"

step "Session 1's Claude sees:"
export CTXFLOW_SESSION="$SESSION1"
echo -e "${DIM}$(node "$CTXFLOW_BIN" context --format text 2>/dev/null || true)${RESET}"
pause

step "Session 2's Claude sees:"
export CTXFLOW_SESSION="$SESSION2"
echo -e "${DIM}$(node "$CTXFLOW_BIN" context --format text 2>/dev/null || true)${RESET}"
pause

# --- Phase 4: Conflict ---

banner "Phase 4: Conflict Detection"

step "Both sessions edit src/api/routes.ts..."
export CTXFLOW_SESSION="$SESSION1"
node "$CTXFLOW_BIN" on-edit --file "src/api/routes.ts" 2>/dev/null || true
export CTXFLOW_SESSION="$SESSION2"
node "$CTXFLOW_BIN" on-edit --file "src/api/routes.ts" 2>/dev/null || true
warn "Both sessions touched the same file!"
echo

step "Session 1's Claude now sees conflict warning:"
export CTXFLOW_SESSION="$SESSION1"
echo -e "${DIM}$(node "$CTXFLOW_BIN" context --format text 2>/dev/null || true)${RESET}"
pause

step "Session 2's Claude also sees the conflict:"
export CTXFLOW_SESSION="$SESSION2"
echo -e "${DIM}$(node "$CTXFLOW_BIN" context --format text 2>/dev/null || true)${RESET}"
pause

# --- Phase 5: Stop sessions ---

banner "Phase 5: Stopping Sessions"

step "Session 1 finishes: ctxflow stop --session $SESSION1"
node "$CTXFLOW_BIN" stop --session "$SESSION1" 2>&1 || true

step "Session 2 is still active:"
cd "$DEMO_DIR" && node "$CTXFLOW_BIN" 2>&1 || true
pause

step "Session 2 finishes: ctxflow stop --session $SESSION2"
node "$CTXFLOW_BIN" stop --session "$SESSION2" 2>&1 || true

# --- Summary ---

banner "Demo Complete!"
echo "  Key takeaways:"
echo "  • Same git user ran two independent ctxflow sessions"
echo "  • Each session tracked its own files and approach notes"
echo "  • Context injection showed each session the other's work"
echo "  • Conflict was automatically detected when both touched routes.ts"
echo "  • Sessions stopped independently without affecting each other"
echo
echo "  To try this yourself:"
echo "    Terminal 1: ctxflow start \"Task A\" && export CTXFLOW_SESSION=<id> && claude"
echo "    Terminal 2: ctxflow start \"Task B\" && export CTXFLOW_SESSION=<id> && claude"
echo
