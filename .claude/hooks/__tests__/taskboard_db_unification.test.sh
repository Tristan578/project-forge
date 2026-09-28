#!/usr/bin/env bash
set -eu
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${PYTHON:-$(command -v python3 || command -v python || true)}"
[ -n "$PYTHON" ] || { echo 'FAIL: Python required'; exit 1; }
# No __pycache__ under __tests__: it is untracked noise in every checkout that
# runs this suite, and .gitignore only learned the nested form with #10291.
export PYTHONDONTWRITEBYTECODE=1
"$PYTHON" -m unittest discover -s "$HERE" -p taskboard_db_unification_test.py -v
