#!/usr/bin/env bash
# PreToolUse hook — enforces TDD red-before-green.
#
# Blocks Edit/Write to PRODUCTION source unless a failing test currently exists,
# so implementation cannot start before a red learning test does. Editing test
# files, docs, and config is always allowed; a refactor escape hatch is provided.
#
# NOTE: this hook is NOT wired in settings.json by default — the project is
# spec-driven (SDD), and this TDD gate is optional. To enable it, add:
#   "hooks": { "PreToolUse": [ { "matcher": "Edit|Write",
#     "hooks": [ { "type": "command",
#       "command": "$CLAUDE_PROJECT_DIR/.claude/hooks/require-red-test.sh" } ] } ] }
#
# Contract (Claude Code hooks): read the tool call as JSON on stdin; exit 0 to
# allow; exit 2 to BLOCK the tool call and return stderr to the agent.
#
# Escape hatch: set TDD_REFACTOR=1 in the environment to allow source edits with
# a green suite (the refactor phase of red-green-refactor).
#
# Fail-open: if the suite cannot be run (fresh checkout, node/npm missing), the
# hook warns and allows, so the harness is never bricked.

set -euo pipefail

INPUT="$(cat)"

# --- extract the target file path (jq if present, else a tolerant grep) ---
FILE_PATH="$(printf '%s' "$INPUT" | jq -r '.tool_input.file_path // empty' 2>/dev/null || true)"
if [ -z "${FILE_PATH:-}" ]; then
  FILE_PATH="$(printf '%s' "$INPUT" \
    | grep -o '"file_path"[[:space:]]*:[[:space:]]*"[^"]*"' | head -1 \
    | sed 's/.*"file_path"[[:space:]]*:[[:space:]]*"//; s/"$//')"
fi

# No path resolved -> don't get in the way.
[ -z "${FILE_PATH:-}" ] && exit 0

# --- always-allowed edits ---------------------------------------------------
# Test files (the whole point is to write these first): vitest specs + Playwright e2e.
case "$FILE_PATH" in
  *.test.ts|*.test.tsx|*.spec.ts|*.spec.tsx|*/e2e/*|*/__tests__/*) exit 0 ;;
esac
# Non-source: only production .ts/.tsx is gated; docs/config/etc. pass.
case "$FILE_PATH" in
  *.ts|*.tsx) : ;;
  *) exit 0 ;;
esac
# Only gate the production source trees (client + server). Import CLI helpers in
# scripts/ are macOS-only glue and not unit-tested here, so leave them ungated.
case "$FILE_PATH" in
  */client/*|client/*|*/server/*|server/*) : ;;
  *) exit 0 ;;
esac

# --- refactor escape hatch --------------------------------------------------
if [ "${TDD_REFACTOR:-0}" = "1" ]; then exit 0; fi

# --- is there a failing test right now? -------------------------------------
if ! command -v npm >/dev/null 2>&1; then
  echo "require-red-test: npm not found; skipping TDD gate (fail-open)." >&2
  exit 0
fi

# Run the suite quietly; a non-zero exit means at least one test is failing (red).
if npm test >/dev/null 2>&1; then
  # Suite is green (or empty) -> no red test to make pass.
  echo "TDD red-before-green: the test suite is green. Write a failing test for this behaviour before editing production source ($FILE_PATH). Set TDD_REFACTOR=1 to edit during the refactor phase." >&2
  exit 2
fi

# Suite is red -> implementing toward green is allowed.
exit 0
