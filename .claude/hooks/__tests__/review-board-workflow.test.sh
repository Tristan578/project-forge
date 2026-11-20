#!/usr/bin/env bash
# Check the legacy workflow refuses ambient agent dispatch.
# Native execution is covered by .claude/tools/test_native_reviewer.py.
set -uo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
command -v node >/dev/null 2>&1 || { echo "FAIL: node is required by this suite"; exit 1; }
# A relative path: Git Bash hands node a /d/... path it cannot open on Windows.
cd "$HERE" && node --test review-board-workflow.test.mjs
