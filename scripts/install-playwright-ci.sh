#!/usr/bin/env bash
# Bound and retry Playwright's apt/browser installation in CI (#9303).
set -u

SCRIPT_DIR="$(cd "${BASH_SOURCE[0]%/*}" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ATTEMPT_TIMEOUT_SECONDS=300
MAX_ATTEMPTS=2

case "${1:-}" in
  browsers) playwright_args=(install --with-deps chromium) ;;
  deps) playwright_args=(install-deps chromium) ;;
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
  echo "Playwright ${1} install attempt ${attempt}/${MAX_ATTEMPTS}"
  timeout --signal=TERM --kill-after=15s \
    "${ATTEMPT_TIMEOUT_SECONDS}s" npx playwright "${playwright_args[@]}"
  exit_code=$?
  if [ "$exit_code" -eq 0 ]; then exit 0; fi
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    echo "::warning::Playwright ${1} install failed with exit ${exit_code}; retrying"
    sleep 5
  fi
done

echo "::error::Playwright ${1} install failed after ${MAX_ATTEMPTS} attempts" >&2
exit "$exit_code"
