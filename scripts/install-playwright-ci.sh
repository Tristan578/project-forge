#!/usr/bin/env bash
# Bound and retry Playwright's apt/browser installation in CI (#9303).
#
# Usage: install-playwright-ci.sh browsers|deps [browser ...]
# The browser list defaults to chromium; the cross-browser job passes
# `chromium firefox webkit` (#9610).
#
# Environment:
#   PLAYWRIGHT_INSTALL_BUDGET_SECONDS  wall-clock budget for all attempts and
#                                      lock waits together (default 660; see
#                                      TOTAL_BUDGET_SECONDS below).
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ATTEMPT_TIMEOUT_SECONDS=300
MAX_ATTEMPTS=5
# Two failure shapes reach this loop and they need opposite amounts of patience.
#
# A genuine hang burns the full attempt timeout per try, so attempts are the
# wrong budget for it -- wall-clock is. A lost dpkg-frontend lock is the
# opposite: apt exits in seconds with code 100
# ("Could not get lock /var/lib/dpkg/lock-frontend ... held by process N"), so
# the old two-attempts-with-a-flat-5s-sleep gave roughly ten seconds of
# tolerance against a lock that unattended-upgrades routinely holds for 30-120s
# on a GitHub-hosted runner. That is what took out both E2E gates on #9662
# (#9675).
#
# So: more attempts with escalating backoff for the fast case, bounded by a
# wall-clock budget so the slow case still terminates before the workflow
# step's outer `timeout-minutes` fires and replaces this script's diagnostic
# with a bare "step timed out". The suite derives that pairing from the
# workflows: every install step's budget plus 45s -- timeout's 15s SIGKILL
# grace and 30s for the step's own startup -- must fit inside its own
# `timeout-minutes` (scripts/__tests__/install-playwright-ci.test.sh).
#
# THE BUDGET IS ENFORCED BY CAPPING, NOT ONLY BY REFUSING. Every attempt's
# timeout is min(ATTEMPT_TIMEOUT_SECONDS, what is left of the budget), and a
# round (backoff, lock wait, attempt) starts only while the budget still holds
# MIN_ATTEMPT_SECONDS for the attempt after its backoff. So no attempt can run
# past the budget however fast and slow failures interleave, and the total is
# bounded by TOTAL_BUDGET_SECONDS plus the 15s kill grace. The only exception
# is the FIRST attempt, which always runs for at least MIN_ATTEMPT_SECONDS --
# reachable only when the budget is configured below that, i.e. never in CI.
#
# The earlier design refused any round that could not fit a FULL 300s attempt
# (elapsed + backoff + 300 >= budget). That bounded the total, but it threw
# away the end of the budget in exactly the case that needs it: after a 300s
# timeout the orphaned apt-get described below is still installing our
# packages, and when it finished, the retry that would have taken a minute was
# refused for want of five.
#
# 660s is the default for the 12-minute steps (660 + 45 <= 720). The
# cross-browser job installs the apt deps of three engines, so it sets
# PLAYWRIGHT_INSTALL_BUDGET_SECONDS on its two install steps ("Install
# Playwright browsers (chromium, firefox, webkit)" and "Install Playwright OS
# deps (cache hit)" in the E2E Cross-Browser job of .github/workflows/ci.yml),
# each with a step timeout sized to match. Set it on the step, never at job or
# workflow level: the suite pairs each budget with its own step's timeout and
# fails on a budget it cannot attribute to one step.
TOTAL_BUDGET_SECONDS="${PLAYWRIGHT_INSTALL_BUDGET_SECONDS:-660}"
# The smallest attempt worth starting. After an orphaned apt-get has finished
# the packages, a retry is an `apt-get update`, a no-op install and the browser
# downloads -- well under two minutes on a hosted runner.
MIN_ATTEMPT_SECONDS=120
BACKOFF_SECONDS=(15 30 60 90)

# WHY A TIMED-OUT ATTEMPT LEAVES THE LOCK HELD (#9665; recurred 2026-10-01, #10315)
#
# `timeout` signals its own process group as a non-root user, and Playwright's
# apt-get runs under sudo, so the ROOT-owned grandchild survives TERM with
# EPERM and keeps the dpkg frontend lock. It is not stuck: it is still
# installing the packages we asked for. On 2026-10-01 that took out nine
# cross-browser job runs across #10314, #10302 and #10307: attempt 1
# reached its 300s timeout mid-install, attempt 2 started a SECOND apt-get
# that waited out the lock timeout below and died with "Unable to acquire the
# dpkg frontend lock ... held by process 2614 (apt-get)" at 498s, and the
# budget refused attempt 3. One re-run passed after 445s in the deps step
# alone -- the install was slow, not broken -- while #10302's webkit job
# failed the same way on two more re-runs.
#
# So before EVERY attempt (the first included, which also covers the
# unattended-upgrades timer on a fresh runner) this script asks who holds the
# dpkg/apt locks and, when someone does, WAITS FOR THAT PROCESS TO EXIT instead
# of starting an apt-get that fights it. A failed attempt that leaves the lock
# held skips its backoff and goes straight to that wait, because the holder's
# exit is the event worth waiting for. The wait is bounded by the budget, minus
# MIN_ATTEMPT_SECONDS for the attempt it gates; a holder that outlives it ends
# the run with an error naming the holder.
#
# Options weighed and rejected:
# - Killing the orphan (or running the attempt as root so `timeout` can reach
#   the whole group). SIGKILL to apt/dpkg mid-unpack leaves dpkg "interrupted"
#   and needing `dpkg --configure -a` -- a worse runner than a slow one. And
#   running npx under sudo installs the browsers into root's cache.
# - Raising ATTEMPT_TIMEOUT_SECONDS alone. A longer attempt still orphans its
#   apt-get when it does time out; it only moves the cliff.
#
# The holder is found with `fuser` on the lock files. A non-root fuser cannot
# see a root process's open files and reports "nobody" -- a false all-clear --
# so off root it runs under `sudo -n`. When neither is available the probe
# says so and the attempt proceeds; apt's own lock timeout below is then the
# only wait.
DPKG_LOCK_FILES="${DPKG_LOCK_FILES:-/var/lib/dpkg/lock-frontend /var/lib/dpkg/lock /var/lib/apt/lists/lock}"
LOCK_POLL_SECONDS=5
LOCK_LOG_EVERY_SECONDS=30

# apt-get exits 100 the *instant* another process holds the dpkg frontend lock.
# This makes the apt-get Playwright runs on our behalf -- which we never invoke
# directly -- WAIT for the lock rather than give up. It is the backstop for a
# holder the probe above could not see, and for one that appears between the
# probe and apt-get taking the lock.
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

# Wall-clock seconds. `date` rather than $SECONDS so the suite can drive the
# budget arithmetic with a fake clock instead of real minutes.
now() { date +%s; }

# Print the PIDs holding any existing lock file. Status: 0 = held (PIDs on
# stdout), 1 = free (or no lock file exists: not an apt host), 2 = cannot tell.
dpkg_lock_holders() {
  local lock_files=() existing=() f out
  read -r -a lock_files <<< "$DPKG_LOCK_FILES"
  for f in ${lock_files[@]+"${lock_files[@]}"}; do
    if [ -e "$f" ]; then existing+=("$f"); fi
  done
  if [ ${#existing[@]} -eq 0 ]; then return 1; fi
  command -v fuser >/dev/null 2>&1 || return 2
  local runner=() err rc out_file
  if [ "$(id -u)" -ne 0 ]; then
    if command -v sudo >/dev/null 2>&1 && sudo -n true >/dev/null 2>&1; then
      runner=(sudo -n)
    else
      return 2
    fi
  fi
  # "Free" must be POSITIVE evidence. fuser exits 1 both when nobody has the
  # files open and when it fails -- a lock file deleted since the -e test above,
  # or `sudo -n fuser` when the sudo PATH cannot resolve fuser ("sudo: fuser:
  # command not found", exit 1, nothing on stdout). Read as free, the second
  # would start an apt-get that fights the holder this probe exists to wait
  # for. Measured on psmisc fuser: an unused file is exit 1 with stdout AND
  # stderr empty, and every error path writes to stderr. So: exit 1 with both
  # streams empty is free, exit 0 with PIDs is held, anything else is unknown.
  out_file="$(mktemp 2>/dev/null)" || return 2
  err="$(${runner[@]+"${runner[@]}"} fuser "${existing[@]}" 2>&1 >"$out_file")"
  rc=$?
  out="$(cat "$out_file")"
  rm -f "$out_file"
  # fuser writes the PIDs to stdout and the file names and access letters to
  # stderr; keep only the digits. It prints a PID once PER LOCK FILE that
  # process holds, and apt-get holds several, so dedupe or the log reads
  # "PID 2614 2614".
  out="$(printf '%s\n' "$out" | tr -cs '0-9' '\n' | grep -E '^[0-9]+$' | sort -un | paste -sd ' ' -)"
  if [ "$rc" -eq 0 ] && [ -n "$out" ]; then
    printf '%s\n' "$out"
    return 0
  fi
  if [ "$rc" -eq 1 ] && [ -z "$out" ] && [ -z "$err" ]; then return 1; fi
  return 2
}

describe_holders() {
  local pids="$1" names
  names="$(ps -o comm= -p "${pids// /,}" 2>/dev/null | tr -s ' \n' ',' | sed 's/^,*//; s/,*$//')"
  printf 'PID %s%s' "$pids" "${names:+ (${names})}"
}

LOCK_PROBE_WARNED=0
LOCK_HOLDERS=""
# Wait up to $1 seconds for every holder of the dpkg/apt locks to exit.
# Returns 0 when the locks are free (or cannot be inspected), 1 when they are
# still held at the deadline, with the holder left in LOCK_HOLDERS.
wait_for_dpkg_lock() {
  local max_wait="$1" holders status waited=0 last_log=0 step wait_started
  holders="$(dpkg_lock_holders)"
  status=$?
  if [ "$status" -eq 2 ]; then
    if [ "$LOCK_PROBE_WARNED" -eq 0 ]; then
      echo "::warning::install-playwright-ci: cannot see the dpkg lock holder (needs fuser, and root or passwordless sudo); relying on apt's own ${APT_LOCK_TIMEOUT_SECONDS}s lock wait"
      LOCK_PROBE_WARNED=1
    fi
    return 0
  fi
  if [ "$status" -ne 0 ]; then return 0; fi
  LOCK_HOLDERS="$(describe_holders "$holders")"
  echo "install-playwright-ci: the dpkg lock is held by ${LOCK_HOLDERS}; waiting up to ${max_wait}s for it to exit rather than starting an apt-get that would fight it"
  wait_started="$(now)"
  while :; do
    waited=$(( $(now) - wait_started ))
    if [ "$waited" -ge "$max_wait" ]; then return 1; fi
    step=$LOCK_POLL_SECONDS
    if [ $((max_wait - waited)) -lt "$step" ]; then step=$((max_wait - waited)); fi
    sleep "$step"
    holders="$(dpkg_lock_holders)"
    status=$?
    waited=$(( $(now) - wait_started ))
    # A probe that saw the holder and then fails has NOT seen it exit. Only a
    # confirmed free lock ends the wait; an unreadable one keeps polling, so a
    # transient probe error cannot start an apt-get that fights the holder.
    if [ "$status" -eq 2 ]; then
      if [ "$LOCK_PROBE_WARNED" -eq 0 ]; then
        echo "::warning::install-playwright-ci: the dpkg lock probe failed while ${LOCK_HOLDERS} held the lock; still waiting rather than treating the lock as released"
        LOCK_PROBE_WARNED=1
      fi
      continue
    fi
    if [ "$status" -ne 0 ]; then
      echo "install-playwright-ci: the dpkg lock was released after ${waited}s"
      LOCK_HOLDERS=""
      return 0
    fi
    LOCK_HOLDERS="$(describe_holders "$holders")"
    if [ $((waited - last_log)) -ge "$LOCK_LOG_EVERY_SECONDS" ]; then
      echo "install-playwright-ci: still waiting for ${LOCK_HOLDERS} after ${waited}s"
      last_log=$waited
    fi
  done
}

configure_apt_lock_wait

cd "$REPO_ROOT/web" || {
  echo "install-playwright-ci: cannot enter $REPO_ROOT/web" >&2
  exit 2
}
started_at="$(now)"
attempts_run=0
exit_code=1
for ((attempt = 1; attempt <= MAX_ATTEMPTS; attempt++)); do
  elapsed=$(( $(now) - started_at ))
  max_wait=$((TOTAL_BUDGET_SECONDS - elapsed - MIN_ATTEMPT_SECONDS))
  if [ "$max_wait" -lt 0 ]; then max_wait=0; fi
  if ! wait_for_dpkg_lock "$max_wait"; then
    echo "::error::Playwright ${mode} install: the dpkg lock is still held by ${LOCK_HOLDERS} after waiting ${max_wait}s, leaving under ${MIN_ATTEMPT_SECONDS}s of the ${TOTAL_BUDGET_SECONDS}s budget; not starting an apt-get that would fight it" >&2
    break
  fi
  elapsed=$(( $(now) - started_at ))
  remaining=$((TOTAL_BUDGET_SECONDS - elapsed))
  if [ "$attempt" -gt 1 ] && [ "$remaining" -lt "$MIN_ATTEMPT_SECONDS" ]; then
    echo "::warning::Playwright ${mode} install exhausted its ${TOTAL_BUDGET_SECONDS}s retry budget after ${elapsed}s; ${remaining}s is under the ${MIN_ATTEMPT_SECONDS}s minimum attempt, so not retrying"
    break
  fi
  attempt_timeout=$ATTEMPT_TIMEOUT_SECONDS
  if [ "$remaining" -lt "$attempt_timeout" ]; then attempt_timeout=$remaining; fi
  if [ "$attempt_timeout" -lt "$MIN_ATTEMPT_SECONDS" ]; then attempt_timeout=$MIN_ATTEMPT_SECONDS; fi
  echo "Playwright ${mode} install attempt ${attempt}/${MAX_ATTEMPTS} (timeout ${attempt_timeout}s)"
  attempts_run=$attempt
  timeout --signal=TERM --kill-after=15s \
    "${attempt_timeout}s" npx playwright "${playwright_args[@]}"
  exit_code=$?
  if [ "$exit_code" -eq 0 ]; then exit 0; fi
  if [ "$attempt" -ge "$MAX_ATTEMPTS" ]; then break; fi
  # A failure that leaves the lock held is the orphan case above: skip the
  # backoff and let the next round's wait watch the holder instead.
  if dpkg_lock_holders >/dev/null; then
    echo "::warning::Playwright ${mode} install failed with exit ${exit_code} and the dpkg lock is still held; waiting for the holder instead of backing off"
    continue
  fi
  elapsed=$(( $(now) - started_at ))
  backoff="${BACKOFF_SECONDS[attempt - 1]}"
  if [ "$((elapsed + backoff + MIN_ATTEMPT_SECONDS))" -gt "$TOTAL_BUDGET_SECONDS" ]; then
    echo "::warning::Playwright ${mode} install exhausted its ${TOTAL_BUDGET_SECONDS}s retry budget after ${elapsed}s; a further ${backoff}s backoff plus a ${MIN_ATTEMPT_SECONDS}s minimum attempt would overrun it, so not retrying"
    break
  fi
  echo "::warning::Playwright ${mode} install failed with exit ${exit_code}; retrying in ${backoff}s"
  sleep "$backoff"
done

echo "::error::Playwright ${mode} install failed after ${attempts_run} of ${MAX_ATTEMPTS} attempts" >&2
exit "$exit_code"
