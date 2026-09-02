#!/usr/bin/env bash
# Bound and retry Playwright's apt/browser installation in CI (#9303).
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ATTEMPT_TIMEOUT_SECONDS=300
MAX_ATTEMPTS=5
# Two failure shapes reach this loop and they need opposite amounts of patience.
#
# A genuine hang burns the full ATTEMPT_TIMEOUT_SECONDS per try, so attempts are
# the wrong budget for it — wall-clock is. A lost dpkg-frontend lock is the
# opposite: apt exits in seconds with code 100
# ("Could not get lock /var/lib/dpkg/lock-frontend ... held by process N"), so
# the old two-attempts-with-a-flat-5s-sleep gave roughly ten seconds of
# tolerance against a lock that unattended-upgrades routinely holds for 30-120s
# on a GitHub-hosted runner. That is what took out both E2E gates on #9662
# (#9675).
#
# So: more attempts with escalating backoff for the fast case, bounded by a
# wall-clock budget so the slow case still terminates before the workflow's
# outer `timeout-minutes: 12` fires and replaces this script's diagnostic with a
# bare "step timed out". A real hang spends 300s an attempt and trips the budget
# after two, exactly as before; a lock race spends seconds an attempt and gets
# the full ~195s of backoff.
TOTAL_BUDGET_SECONDS="${PLAYWRIGHT_INSTALL_BUDGET_SECONDS:-600}"
BACKOFF_SECONDS=(15 30 60 90)

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
started_at=$SECONDS
for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
  echo "Playwright ${1} install attempt ${attempt}/${MAX_ATTEMPTS}"
  timeout --signal=TERM --kill-after=15s \
    "${ATTEMPT_TIMEOUT_SECONDS}s" npx playwright "${playwright_args[@]}"
  exit_code=$?
  if [ "$exit_code" -eq 0 ]; then exit 0; fi
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    elapsed=$((SECONDS - started_at))
    if [ "$elapsed" -ge "$TOTAL_BUDGET_SECONDS" ]; then
      echo "::warning::Playwright ${1} install exhausted its ${TOTAL_BUDGET_SECONDS}s retry budget after ${elapsed}s; not retrying"
      break
    fi
    backoff="${BACKOFF_SECONDS[attempt - 1]}"
    echo "::warning::Playwright ${1} install failed with exit ${exit_code}; retrying in ${backoff}s"
    sleep "$backoff"
  fi
done

echo "::error::Playwright ${1} install failed after ${MAX_ATTEMPTS} attempts" >&2
exit "$exit_code"
