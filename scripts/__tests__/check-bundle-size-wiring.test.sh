#!/usr/bin/env bash
set -u

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CI_FILE="${CI_FILE:-$ROOT/.github/workflows/ci.yml}"
FAILURES=0

pass() { printf 'PASS: %s\n' "$1"; }
fail() { printf 'FAIL: %s\n' "$1"; FAILURES=$((FAILURES + 1)); }

validate_wiring() {
  local file="$1" job step count
  job="$(awk '
    /^  build-nextjs:[[:space:]]*$/ { in_job=1 }
    in_job && /^  [A-Za-z_][A-Za-z0-9_-]*:[[:space:]]*$/ && $0 !~ /^  build-nextjs:/ { exit }
    in_job { print }
  ' "$file")"

  [ -n "$job" ] || return 1
  count="$(grep -c '^      - name: Check JS bundle size[[:space:]]*$' <<<"$job")"
  [ "$count" -eq 1 ] || return 1

  step="$(awk '
    /^      - name: Check JS bundle size[[:space:]]*$/ { in_step=1 }
    in_step && seen && /^      - / { exit }
    in_step { print; seen=1 }
  ' <<<"$job")"

  [ "$(grep -c '^        run:' <<<"$step")" -eq 1 ] || return 1
  grep -q '^        run: node scripts/check-bundle-size\.js[[:space:]]*$' <<<"$step" || return 1
  [ "$(grep -c '^        working-directory: web[[:space:]]*$' <<<"$step")" -eq 1 ] || return 1
  ! grep -qE '^        (continue-on-error|if):' <<<"$step" || return 1
}

if validate_wiring "$CI_FILE"; then
  pass 'bundle-size gate has one blocking invocation in the Next.js build job'
else
  fail 'bundle-size gate must have exactly one web-scoped run and no step-level if/continue-on-error'
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

assert_mutation_rejected() {
  local name="$1"
  local sed_expr="$2"
  local mutated="$tmp/${name// /-}.yml"
  sed "$sed_expr" "$CI_FILE" > "$mutated"
  if validate_wiring "$mutated"; then
    fail "$name was not rejected"
  else
    pass "$name is rejected"
  fi
}

assert_append_rejected() {
  local name="$1"
  local inserted="$2"
  local mutated="$tmp/${name// /-}.yml"
  awk -v inserted="$inserted" '
    { print }
    /^        run: node scripts\/check-bundle-size\.js$/ { print inserted }
  ' "$CI_FILE" > "$mutated"
  if validate_wiring "$mutated"; then
    fail "$name was not rejected"
  else
    pass "$name is rejected"
  fi
}

assert_mutation_rejected 'removed invocation' '/^        run: node scripts\/check-bundle-size\.js$/d'
assert_append_rejected 'duplicate run key' '        run: echo bypassed'
assert_append_rejected 'continue-on-error bypass' '        continue-on-error: true'
assert_append_rejected 'step-level false condition' '        if: false'
assert_mutation_rejected 'wrong working directory' 's/^        working-directory: web$/        working-directory: scripts/'

if [ "$FAILURES" -ne 0 ]; then
  printf '\n%d test(s) failed.\n' "$FAILURES"
  exit 1
fi
printf '\nAll bundle-size wiring tests passed.\n'
