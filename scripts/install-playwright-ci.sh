#!/usr/bin/env bash
# Bound and retry Playwright's apt/browser installation in CI (#9303).
#
# Usage: install-playwright-ci.sh browsers|deps [browser ...]
# The browser list defaults to chromium; the cross-browser job passes
# `chromium firefox webkit` (#9610).
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ATTEMPT_TIMEOUT_SECONDS=300
MAX_ATTEMPTS=2

mode="${1:-}"
if [ $# -gt 0 ]; then shift; fi
browsers=("$@")
if [ ${#browsers[@]} -eq 0 ]; then browsers=(chromium); fi
case "$mode" in
  browsers) playwright_args=(install --with-deps "${browsers[@]}") ;;
  deps) playwright_args=(install-deps "${browsers[@]}") ;;
  *)
    echo "install-playwright-ci: expected mode 'browsers' or 'deps'" >&2
    exit 2
    ;;
esac

command -v timeout >/dev/null 2>&1 || { echo "install-playwright-ci: 'timeout' is required" >&2; exit 2; }
command -v npx >/dev/null 2>&1 || { echo "install-playwright-ci: 'npx' is required" >&2; exit 2; }

cd "$REPO_ROOT/web" || {
  echo "install-playwright-ci: cannot enter $REPO_ROOT/web" >&2
  exit 2
}
for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
  echo "Playwright ${mode} install attempt ${attempt}/${MAX_ATTEMPTS}"
  timeout --signal=TERM --kill-after=15s \
    "${ATTEMPT_TIMEOUT_SECONDS}s" npx playwright "${playwright_args[@]}"
  exit_code=$?
  if [ "$exit_code" -eq 0 ]; then exit 0; fi
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    echo "::warning::Playwright ${mode} install failed with exit ${exit_code}; retrying"
    sleep 5
  fi
done

echo "::error::Playwright ${mode} install failed after ${MAX_ATTEMPTS} attempts" >&2
exit "$exit_code"
