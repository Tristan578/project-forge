#!/usr/bin/env bash
# Runs the node:test suite for .claude/workflows/review-board.js (#10325): the
# round cap, fix-diff re-reviews with only the named seats, carried seats in
# the published count, and a board decided by blocking findings. It lives in
# this directory so the hook-tests job (and the Windows job) run it from their
# glob; ci-gate's needs-hooks filter matches .claude/workflows/ for that reason.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "FAIL: node is required by this suite"; exit 1; }
# A relative path: Git Bash hands node a /d/... path it cannot open on Windows.
cd "$HERE" && node --test review-board-workflow.test.mjs
