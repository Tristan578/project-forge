#!/usr/bin/env bash
# Shared platform contract for the bash suites (#9611).
#
# Two things used to be spelled "skipped" by ad-hoc helpers, and they are not
# the same thing:
#
#   unsupported_on <platform> <reason>
#       The thing UNDER TEST cannot run here (a POSIX-only lock; a symlink the
#       host cannot create for the fixture that IS the test). Prints a marker
#       and exits NON-ZERO with the reserved code 3. A suite that cannot
#       exercise its subject has not passed; the workflow that runs it on that
#       platform decides — in the open, per suite — whether 3 is acceptable
#       there, instead of a green line hiding it (lessons-learned #9).
#
#   probe_skip <reason>
#       A host-capability gap that is NOT the thing under test (a probe fixture
#       could not be planted; the case it guards is one of many). Prints a
#       marker and lets the suite continue. Under CI it is upgraded to a
#       failure through the suite's own `fail` (or `bad`) function: coverage
#       may thin out on a developer laptop, never on the runner that gates
#       merges. This is the contract check-agentic-sync.test.sh and
#       neon-branch.test.sh already implemented locally; it is shared so the
#       next suite does not reinvent a weaker one.
#
#   probe_skip_absent_on <platform> <reason>
#       A probe gap on a platform that CANNOT close it — Git-for-Windows
#       without Developer Mode cannot create a symlink at all; NTFS through it
#       accepts chmod and still reports -rw-r--r--. Probe-first is unchanged:
#       the caller has already probed and found the capability missing. What
#       changes is the CI upgrade, which is suppressed only when the run is ON
#       <platform>, because there the gap belongs to the host and no change to
#       this repo could clear it. Every OTHER platform still fails in CI, so
#       the case stays gated wherever it can actually execute — the Windows
#       sweep exists to prove the harness RUNS there, not to re-verify POSIX
#       semantics Linux CI already gates. Never reach for this on the platform
#       a case exists to protect.
#
# Both markers start with a fixed token so a log can be grepped for either.
# Source with:  . "$(dirname "${BASH_SOURCE[0]}")/lib/platform.sh"

readonly PLATFORM_UNSUPPORTED_EXIT=3

platform_name() {
  case "$(uname -s 2>/dev/null)" in
    Linux*) echo linux ;;
    Darwin*) echo macos ;;
    MINGW*|MSYS*|CYGWIN*) echo windows ;;
    *) echo unknown ;;
  esac
}

unsupported_on() {
  local platform="${1:?platform}" reason="${2:?reason}"
  echo "UNSUPPORTED on ${platform}: ${reason}" >&2
  exit "$PLATFORM_UNSUPPORTED_EXIT"
}

probe_skip_absent_on() {
  local platform="${1:?platform}" reason="${2:?reason}"
  if [ "$(platform_name)" = "$platform" ]; then
    echo "  SKIP (${platform} cannot provide this): ${reason}"
    return 0
  fi
  probe_skip "$reason"
}

probe_skip() {
  local reason="${1:?reason}"
  echo "  SKIP: ${reason}"
  if [ "${CI:-}" = "true" ]; then
    if declare -f fail >/dev/null 2>&1; then
      fail "skipped in CI: ${reason}"
    elif declare -f bad >/dev/null 2>&1; then
      bad "skipped in CI: ${reason}"
    else
      echo "  FAIL: skipped in CI: ${reason} (suite defines no fail/bad hook — exiting non-zero)"
      exit 1
    fi
  fi
}
