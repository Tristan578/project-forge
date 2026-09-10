#!/usr/bin/env bash
set -eu
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${PYTHON:-$(command -v python3 || command -v python || true)}"
[ -n "$PYTHON" ] || { echo 'FAIL: Python required'; exit 1; }
"$PYTHON" -m unittest discover -s "$HERE" -p taskboard_sync_test.py -v
