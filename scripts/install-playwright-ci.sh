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
# outer `timeout-minutes: 12` (720s) fires and replaces this script's diagnostic
# with a bare "step timed out". A real hang spends 300s an attempt and trips the
# budget after two; a lock race spends seconds an attempt and gets the full
# ~195s of backoff.
#
# The budget is checked as a LOOK-AHEAD -- "would the rest of another round
# overrun it" -- not as "have we overrun it already". Checking after the fact
# bounds nothing, because the check is what gates starting the attempt that
# would blow past it: three fast lock failures cost ~120s including backoff,
# leaving elapsed=120 well under any budget, and the two 300s hangs that can
# follow put the total at 810s -- past the outer timeout, i.e. exactly the
# failure this budget exists to prevent.
#
# The look-ahead must count the backoff as well as the attempt, because the
# sleep happens after the check and before the attempt it gates. Counting only
# the attempt leaves the largest backoff outside the bound, and that gap is
# reachable: three instant failures then a 254s one puts elapsed at 359, which
# clears a 300s-only look-ahead against a 660s budget, after which the 90s
# backoff and a final 300s hang land at 764s -- past the outer timeout again.
# Counting both means a round starts only while
# elapsed + backoff + ATTEMPT_TIMEOUT_SECONDS < TOTAL_BUDGET_SECONDS, so the
# total is bounded by TOTAL_BUDGET_SECONDS (plus timeout's 15s SIGKILL grace,
# i.e. 675s) no matter how the fast and slow shapes interleave.
#
# 660 rather than 600 so the look-ahead still permits the second attempt of a
# pure hang: after the first, elapsed=300 and 300 + 15 + 300 < 660. That case
# ends at ~615s, and the bound above keeps every other case under 675s.
TOTAL_BUDGET_SECONDS="${PLAYWRIGHT_INSTALL_BUDGET_SECONDS:-660}"
BACKOFF_SECONDS=(15 30 60 90)

# apt-get exits 100 the *instant* another process holds the dpkg frontend lock,
# so a retry after a timeout can fail in under a second having installed
# nothing: `timeout` signals its own process group as a non-root user, and
# Playwright's apt-get runs under sudo, so the ROOT-owned grandchild survives
# TERM with EPERM and keeps the lock. That is exactly how #9665's E2E Journey
# Gate died -- attempt 1 hit the attempt timeout mid-download, attempt 2 hit
# "Could not get lock /var/lib/dpkg/lock-frontend ... held by process 2778
# (apt-get)" and exit 100. The escalating backoff above buys time for that; this
# makes apt WAIT for the lock rather than give up, and it reaches the apt-get
# Playwright runs on our behalf, which we never invoke directly. It also covers
# the unattended-upgrades timer, the usual cause of this on a fresh runner.
APT_CONF_DIR="${APT_CONF_DIR:-/etc/apt/apt.conf.d}"
APT_LOCK_TIMEOUT_SECONDS="${APT_LOCK_TIMEOUT_SECONDS:-180}"

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

# Say which branch was taken every time. A helper that silently no-ops on a
# host without apt reads as "configured" in the log, and this one is only
# load-bearing on the one host shape nobody runs it on locally.
configure_apt_lock_wait() {
  local conf="$APT_CONF_DIR/99-spawnforge-lock-timeout"
  local body="DPkg::Lock::Timeout \"${APT_LOCK_TIMEOUT_SECONDS}\";"
  if [ ! -d "$APT_CONF_DIR" ]; then
    echo "install-playwright-ci: no $APT_CONF_DIR; skipping apt lock-wait config (non-apt host)"
    return 0
  fi
  if printf '%s\n' "$body" > "$conf" 2>/dev/null; then
    echo "install-playwright-ci: apt will wait up to ${APT_LOCK_TIMEOUT_SECONDS}s for the dpkg lock"
    return 0
  fi
  if command -v sudo >/dev/null 2>&1 && printf '%s\n' "$body" | sudo tee "$conf" >/dev/null 2>&1; then
    echo "install-playwright-ci: apt will wait up to ${APT_LOCK_TIMEOUT_SECONDS}s for the dpkg lock (via sudo)"
    return 0
  fi
  echo "::warning::install-playwright-ci: could not write $conf; a retry may hit a held dpkg lock"
  return 0
}

configure_apt_lock_wait

cd "$REPO_ROOT/web" || {
  echo "install-playwright-ci: cannot enter $REPO_ROOT/web" >&2
  exit 2
}
started_at=$SECONDS
for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
  echo "Playwright ${mode} install attempt ${attempt}/${MAX_ATTEMPTS}"
  timeout --signal=TERM --kill-after=15s \
    "${ATTEMPT_TIMEOUT_SECONDS}s" npx playwright "${playwright_args[@]}"
  exit_code=$?
  if [ "$exit_code" -eq 0 ]; then exit 0; fi
  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    elapsed=$((SECONDS - started_at))
    backoff="${BACKOFF_SECONDS[attempt - 1]}"
    if [ "$((elapsed + backoff + ATTEMPT_TIMEOUT_SECONDS))" -ge "$TOTAL_BUDGET_SECONDS" ]; then
      echo "::warning::Playwright ${mode} install exhausted its ${TOTAL_BUDGET_SECONDS}s retry budget after ${elapsed}s; a further ${backoff}s backoff plus a ${ATTEMPT_TIMEOUT_SECONDS}s attempt would overrun it, so not retrying"
      break
    fi
    echo "::warning::Playwright ${mode} install failed with exit ${exit_code}; retrying in ${backoff}s"
    sleep "$backoff"
  fi
done

echo "::error::Playwright ${mode} install failed after ${MAX_ATTEMPTS} attempts" >&2
exit "$exit_code"
