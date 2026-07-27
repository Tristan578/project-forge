#!/usr/bin/env bash
# Tests for the committed permission posture in .claude/settings.json:
#   * a `permissions.allow` allow-list of safe read/build/test commands,
#   * a `permissions.deny` guard protecting the two off-limits config files
#     (.claude/settings.json and .codex/config.toml) for BOTH Edit and Write,
#   * the auto-approve-safe-commands.sh hook wired as a PreToolUse Bash hook.
#
# Deny paths use the gitignore-anchored, project-root form `/<path>` so they
# match regardless of the agent's current working directory. Edit and Write are
# distinct permission tools, so each off-limits file is denied for both.
#
# Run: bash .claude/hooks/__tests__/settings-permissions.test.sh
set -uo pipefail

command -v jq >/dev/null 2>&1 || { echo "jq is required to run these tests"; exit 1; }
command -v mktemp >/dev/null 2>&1 || { echo "mktemp is required to run these tests"; exit 1; }

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# Test-only seam: point the suite at a fixture copy. Negative-path coverage
# for the permission-mode guards below is obtained by SELF-RE-EXEC — see the
# "Negative coverage via self-re-exec" block near the end of this file, which
# jq-mutates a copy of the real settings, sets this var to point at it, and
# asserts on the re-exec'd child's exit code. NEVER set this var in CI outside
# that self-re-exec: the seam_not_wired self-defense scan below AND the
# parent-only runtime CI assertion (same block) both enforce that.
SETTINGS="${SETTINGS_PERMISSIONS_FILE:-$HERE/../../settings.json}"

pass=0
fail=0

# assert_jq <desc> <jq-arg>... <filter> — pass when the jq query succeeds (exit
# 0, truthy) against settings.json. Everything after <desc> is forwarded to jq
# verbatim, so callers may pass `--arg name value` ahead of the filter.
assert_jq() {
  local desc="$1"; shift
  if jq -e "$@" "$SETTINGS" >/dev/null 2>&1; then
    pass=$((pass + 1))
    printf '  ok   %s\n' "$desc"
  else
    fail=$((fail + 1))
    printf '  FAIL %s\n' "$desc"
  fi
}

echo "settings.json permissions"

# --- Valid JSON & block shape ---
assert_jq "settings.json is valid JSON"        '.'
assert_jq "permissions is an object"           '.permissions | type == "object"'
assert_jq "permissions.allow is a non-empty array" '(.permissions.allow | type == "array") and (.permissions.allow | length > 0)'
assert_jq "permissions.deny is a non-empty array"  '(.permissions.deny | type == "array") and (.permissions.deny | length > 0)'

# --- Allow rules. The STATIC fast-path holds ONLY commands that are safe with
#     ANY arguments, because a native prefix rule (`Bash(npm ci:*)`) is
#     flag-blind — it cannot tell `git diff HEAD` from `git diff --output=/etc/x`
#     or `cargo check` from `cargo check --config build.rustc-wrapper=./evil`.
#     Flag-sensitive read/build commands (git diff/log/show, cargo check, the npx
#     JS tools) live in the auto-approve HOOK instead, which gates the
#     exec/write flag forms (asserted in auto-approve-safe-commands.test.sh).
#     Every entry in the committed allow-list is asserted here, so a silent drop
#     or rename is caught. ---
for rule in \
  'Bash(npm ci:*)' \
  'Bash(npm install:*)' \
  'Bash(npm run:*)' \
  'Bash(npm test:*)' \
  'Bash(npm ls:*)' \
  'Bash(git status:*)' \
  'Bash(git rev-parse:*)' ; do
  # shellcheck disable=SC2016  # $r is a jq variable bound via --arg, not a shell var
  assert_jq "allow contains $rule" --arg r "$rule" '.permissions.allow | index($r) != null'
done

# The committed allow-list has exactly these 7 entries and no more — a new
# auto-allow rule must be added to the loop above (and justified) before it lands.
assert_jq "allow-list has exactly 7 entries" '.permissions.allow | length == 7'

# --- Off-limits file guards: project-root-anchored, Edit AND Write ---
for rule in \
  'Edit(/.claude/settings.json)' \
  'Write(/.claude/settings.json)' \
  'Edit(/.codex/config.toml)' \
  'Write(/.codex/config.toml)' ; do
  # shellcheck disable=SC2016  # $r is a jq variable bound via --arg, not a shell var
  assert_jq "deny contains $rule" --arg r "$rule" '.permissions.deny | index($r) != null'
done

# --- Negative guards (dangerous): never auto-allowed by EITHER layer.
#     `npm exec` runs arbitrary package binaries; `git branch`/`git tag` look
#     read-only but their flag forms mutate refs (`git branch -D`, `git tag -d`),
#     so a `Bash(git branch:*)`/`Bash(git tag:*)` prefix rule would auto-approve
#     destructive writes; `npx drizzle-kit` (`drop`/`push`) is DB-destructive; the
#     rest mutate state. All belong on a prompt, never the fast-path. ---
for rule in \
  'Bash(npm exec:*)' \
  'Bash(npm publish:*)' \
  'Bash(git push:*)' \
  'Bash(git branch:*)' \
  'Bash(git tag:*)' \
  'Bash(npx drizzle-kit:*)' \
  'Bash(rm:*)' \
  'Bash(rm -rf:*)' ; do
  # shellcheck disable=SC2016  # $r is a jq variable bound via --arg, not a shell var
  assert_jq "allow does NOT contain $rule" --arg r "$rule" '.permissions.allow | index($r) == null'
done

# --- Negative guards (flag-sensitive): SAFE in the flag-aware hook, but
#     deliberately kept OFF the static fast-path. A native prefix rule is
#     flag-blind, so `Bash(git diff:*)` would auto-approve `git diff
#     --output=/etc/cron.d/evil` (arbitrary write) or `git diff -x ./evil` (RCE),
#     and `Bash(cargo check:*)` would auto-approve `cargo check --config
#     build.rustc-wrapper=./evil` (RCE), and `Bash(npx eslint:*)` etc. would
#     auto-approve `--config <executable-config>`. These run through the hook,
#     which sends the exec/write flag forms to a prompt. ---
#     `npm audit` is here too: bare `npm audit` is a read, but a `Bash(npm audit:*)`
#     prefix rule is subcommand-blind and would auto-approve `npm audit fix` (which
#     runs `npm install` lifecycle scripts and rewrites the lockfile). The hook
#     distinguishes the read form from `fix`; the static fast-path cannot. ---
for rule in \
  'Bash(git diff:*)' \
  'Bash(git log:*)' \
  'Bash(git show:*)' \
  'Bash(cargo check:*)' \
  'Bash(npm audit:*)' \
  'Bash(npx vitest:*)' \
  'Bash(npx eslint:*)' \
  'Bash(npx tsc:*)' \
  'Bash(npx playwright:*)' ; do
  # shellcheck disable=SC2016  # $r is a jq variable bound via --arg, not a shell var
  assert_jq "allow does NOT contain (hook-only) $rule" --arg r "$rule" '.permissions.allow | index($r) == null'
done

# --- The auto-approve hook is wired as a PreToolUse hook matching Bash ---
# shellcheck disable=SC2016  # jq filter; no shell expansion intended
assert_jq "auto-approve hook wired under PreToolUse with a Bash matcher" '
  [ .hooks.PreToolUse[]
    | select(any(.hooks[]?; .command | test("auto-approve-safe-commands\\.sh")))
    | .matcher // "" ]
  | any(test("Bash"))
'

# --- Permission-mode guards: the pinned allow-list is meaningless if the
#     mode bypasses prompting entirely. This guard pins the allow-set
#     {default, plan} — every other value fails closed: "bypassPermissions"
#     and "acceptEdits" are committed-posture weakenings, "auto" and
#     "dontAsk" are additional documented modes that also weaken prompting,
#     "manual" is a documented alias of "default" that this guard still
#     rejects (accepted fail-closed noise, not a bug), and any unknown or
#     future mode name fails the same way. ---
# shellcheck disable=SC2016  # jq filter; no shell expansion intended
assert_jq "defaultMode absent, \"default\", or \"plan\" — all other modes (bypassPermissions/acceptEdits/auto/dontAsk/manual/unknown) fail closed" '
  (.permissions.defaultMode // "default") as $m
  | ($m == "default" or $m == "plan")
'
# shellcheck disable=SC2016  # jq filter; no shell expansion intended
assert_jq "additionalDirectories absent or empty (no widened write surface)" '
  (.permissions.additionalDirectories // []) | length == 0
'
# shellcheck disable=SC2016  # jq filter; no shell expansion intended
assert_jq "disableBypassPermissionsMode absent or the hardening value \"disable\"" '
  (.permissions.disableBypassPermissionsMode // "disable") == "disable"
'
# shellcheck disable=SC2016  # jq filter; no shell expansion intended
assert_jq "disableAutoMode absent or the hardening value \"disable\"" '
  (.permissions.disableAutoMode // "disable") == "disable"
'

# --- Seam self-defense: SETTINGS_PERMISSIONS_FILE must never be wired in a
#     workflow — that would validate a fixture instead of the real file.
#     Fail closed if the workflows dir is missing (mis-rooted checkout) or a
#     scan error occurs.
#
# seam_not_wired <dir> — true (0) iff <dir> exists AND no non-comment line
# anywhere under it names SETTINGS_PERMISSIONS_FILE. Distinguishes grep's exit
# codes: 1 (no match at all) means "not wired" => 0; >=2 (scan/read error,
# e.g. an unreadable file) is treated as failure => 1, fail-closed rather than
# silently passing on a broken scan.
#
# COMMENT-STRIP: of the lines that DO name the seam, strip full-comment lines
# (leading whitespace then `#`) before deciding — a doc comment that merely
# mentions the seam name (e.g. this very file's own comments, or a gotchas.md
# fragment quoted in a workflow) must not trip the guard; a real `env:` wiring
# is a non-comment line and is still caught. Mirrors the convention in
# scripts/__tests__/check-ghaw-lock-sync.test.sh. ---
seam_not_wired() {
  local dir="$1"
  [ -d "$dir" ] || return 1
  local hits rc
  hits="$(grep -rh "SETTINGS_PERMISSIONS_FILE" "$dir" 2>/dev/null)"
  rc=$?
  if [ "$rc" -ge 2 ]; then
    return 1
  fi
  if [ "$rc" -eq 1 ]; then
    return 0
  fi
  local stripped
  stripped="$(grep -v '^[[:space:]]*#' <<<"$hits")"
  [ -z "$stripped" ]
}

# --- Hermetic self-tests for seam_not_wired(): exercise the helper directly
#     against synthetic fixture directories (created OUTSIDE the repo tree via
#     mktemp, cleaned up immediately below) so the guard's own logic has
#     coverage independent of whatever the real .github/workflows currently
#     contains. ---
SEAM_TMPROOT="$(mktemp -d)" || { echo "mktemp -d failed"; exit 1; }
trap 'rm -rf "$SEAM_TMPROOT"' EXIT
mkdir -p "$SEAM_TMPROOT/clean/workflows" "$SEAM_TMPROOT/wired/workflows" "$SEAM_TMPROOT/comment-only/workflows"

# (a) innocent workflow, no mention of the seam at all
cat > "$SEAM_TMPROOT/clean/workflows/ci.yml" <<'EOF'
name: CI
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - run: npm test
EOF

# (b) a workflow genuinely wiring the seam in a real (executable) env line
cat > "$SEAM_TMPROOT/wired/workflows/evil.yml" <<'EOF'
name: Neuter
on: push
jobs:
  test:
    runs-on: ubuntu-latest
    env:
      SETTINGS_PERMISSIONS_FILE: /tmp/fixture.json
    steps:
      - run: bash .claude/hooks/__tests__/settings-permissions.test.sh
EOF

# (c) the only mention of the seam is inside a full-comment line
cat > "$SEAM_TMPROOT/comment-only/workflows/doc.yml" <<'EOF'
name: Doc
on: push
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      # This job intentionally never sets SETTINGS_PERMISSIONS_FILE — see gotchas.md
      - run: npm test
EOF

if seam_not_wired "$SEAM_TMPROOT/clean/workflows"; then
  pass=$((pass + 1)); printf '  ok   %s\n' "seam_not_wired: clean workflow dir reports not-wired"
else
  fail=$((fail + 1)); printf '  FAIL %s\n' "seam_not_wired: clean workflow dir should report not-wired"
fi

if ! seam_not_wired "$SEAM_TMPROOT/wired/workflows"; then
  pass=$((pass + 1)); printf '  ok   %s\n' "seam_not_wired: workflow wiring the seam in an executable line reports wired"
else
  fail=$((fail + 1)); printf '  FAIL %s\n' "seam_not_wired: workflow wiring the seam in an executable line should report wired"
fi

if seam_not_wired "$SEAM_TMPROOT/comment-only/workflows"; then
  pass=$((pass + 1)); printf '  ok   %s\n' "seam_not_wired: seam name only inside a full-comment line reports not-wired"
else
  fail=$((fail + 1)); printf '  FAIL %s\n' "seam_not_wired: seam name only inside a full-comment line should report not-wired"
fi

if ! seam_not_wired "$SEAM_TMPROOT/does-not-exist"; then
  pass=$((pass + 1)); printf '  ok   %s\n' "seam_not_wired: nonexistent dir fails closed (reports wired)"
else
  fail=$((fail + 1)); printf '  FAIL %s\n' "seam_not_wired: nonexistent dir should fail closed (report wired)"
fi

# (e) grep scan-error path: an unreadable file inside the fixture dir must
#     fail closed, not be silently treated as "no match".
mkdir -p "$SEAM_TMPROOT/unreadable/workflows"
echo "SETTINGS_PERMISSIONS_FILE: /tmp/x" > "$SEAM_TMPROOT/unreadable/workflows/secret.yml"
chmod 000 "$SEAM_TMPROOT/unreadable/workflows/secret.yml"
if ! seam_not_wired "$SEAM_TMPROOT/unreadable/workflows"; then
  pass=$((pass + 1)); printf '  ok   %s\n' "seam_not_wired: unreadable file (grep scan error) fails closed (reports wired)"
else
  fail=$((fail + 1)); printf '  FAIL %s\n' "seam_not_wired: unreadable file (grep scan error) should fail closed (report wired)"
fi

# --- Real check: apply the helper to the actual workflows directory AND any
#     composite actions under .github/actions/ (mirrors the precedent in
#     scripts/__tests__/check-native-bindings.test.sh:136-137 — an existence
#     test on .github/actions keeps a missing dir from poisoning the result,
#     since seam_not_wired already fails closed on a missing dir on its own). ---
seam_dirs=("$HERE/../../../.github/workflows")
[ -d "$HERE/../../../.github/actions" ] && seam_dirs+=("$HERE/../../../.github/actions")

seam_real_clean=true
for seam_dir in "${seam_dirs[@]}"; do
  seam_not_wired "$seam_dir" || seam_real_clean=false
done

if $seam_real_clean; then
  pass=$((pass + 1)); printf '  ok   %s\n' "seam SETTINGS_PERMISSIONS_FILE not wired in any workflow or composite action"
else
  fail=$((fail + 1)); printf '  FAIL %s\n' "seam SETTINGS_PERMISSIONS_FILE wired in a workflow or composite action (or a scanned dir missing/unreadable)"
fi

# --- Negative coverage via self-re-exec: SETTINGS_PERMISSIONS_SELFTEST=1
#     tells a re-exec'd child to skip THIS block (preventing infinite
#     recursion) — the child still runs the rest of the suite above, but
#     against the bad fixture pointed to by SETTINGS_PERMISSIONS_FILE, so its
#     own $fail count (and therefore its exit code) reflects whether the
#     mutated posture value was rejected. The parent-only runtime CI
#     assertion below (same guard) catches out-of-tree wiring no static grep
#     could ever see: a composite action or org-level env exporting
#     SETTINGS_PERMISSIONS_FILE via $GITHUB_ENV rather than a literal string
#     in a committed file. ---
if [ -z "${SETTINGS_PERMISSIONS_SELFTEST:-}" ]; then
  run_selftest_child() {
    SETTINGS_PERMISSIONS_SELFTEST=1 SETTINGS_PERMISSIONS_FILE="$1" bash "${BASH_SOURCE[0]}" >/dev/null 2>&1
  }

  assert_child_rejects() {
    local desc="$1" fixture="$2"
    if ! run_selftest_child "$fixture"; then
      pass=$((pass + 1)); printf '  ok   %s\n' "$desc"
    else
      fail=$((fail + 1)); printf '  FAIL %s\n' "$desc"
    fi
  }

  assert_child_accepts() {
    local desc="$1" fixture="$2"
    if run_selftest_child "$fixture"; then
      pass=$((pass + 1)); printf '  ok   %s\n' "$desc"
    else
      fail=$((fail + 1)); printf '  FAIL %s\n' "$desc"
    fi
  }

  make_bad_fixture() {
    jq "$2" "$SETTINGS" > "$SEAM_TMPROOT/badcfg/$1"
  }

  mkdir -p "$SEAM_TMPROOT/badcfg"
  make_bad_fixture "default-mode-bypass.json"      '.permissions.defaultMode = "bypassPermissions"'
  make_bad_fixture "default-mode-acceptedits.json" '.permissions.defaultMode = "acceptEdits"'
  make_bad_fixture "default-mode-auto.json"        '.permissions.defaultMode = "auto"'
  make_bad_fixture "default-mode-dontask.json"     '.permissions.defaultMode = "dontAsk"'
  make_bad_fixture "additional-dirs.json"          '.permissions.additionalDirectories = ["/"]'
  make_bad_fixture "disable-bypass-allow.json"     '.permissions.disableBypassPermissionsMode = "allow"'
  make_bad_fixture "disable-auto-allow.json"       '.permissions.disableAutoMode = "allow"'
  make_bad_fixture "default-mode-plan.json"        '.permissions.defaultMode = "plan"'

  assert_child_rejects "self-test: defaultMode=bypassPermissions rejected by child re-exec" "$SEAM_TMPROOT/badcfg/default-mode-bypass.json"
  assert_child_rejects "self-test: defaultMode=acceptEdits rejected by child re-exec" "$SEAM_TMPROOT/badcfg/default-mode-acceptedits.json"
  assert_child_rejects "self-test: defaultMode=auto rejected by child re-exec" "$SEAM_TMPROOT/badcfg/default-mode-auto.json"
  assert_child_rejects "self-test: defaultMode=dontAsk rejected by child re-exec" "$SEAM_TMPROOT/badcfg/default-mode-dontask.json"
  assert_child_rejects "self-test: additionalDirectories=[\"/\"] rejected by child re-exec" "$SEAM_TMPROOT/badcfg/additional-dirs.json"
  assert_child_rejects "self-test: disableBypassPermissionsMode=allow rejected by child re-exec" "$SEAM_TMPROOT/badcfg/disable-bypass-allow.json"
  assert_child_rejects "self-test: disableAutoMode=allow rejected by child re-exec" "$SEAM_TMPROOT/badcfg/disable-auto-allow.json"
  assert_child_accepts "self-test: defaultMode=plan accepted by child re-exec (positive control)" "$SEAM_TMPROOT/badcfg/default-mode-plan.json"

  # --- Parent-only runtime CI assertion ---
  if [ -n "${SETTINGS_PERMISSIONS_FILE:-}" ] && [ -n "${CI:-}" ]; then
    fail=$((fail + 1)); printf '  FAIL %s\n' "runtime: SETTINGS_PERMISSIONS_FILE must never be set in CI (out-of-tree wiring detected)"
  else
    pass=$((pass + 1)); printf '  ok   %s\n' "runtime: SETTINGS_PERMISSIONS_FILE is unset in CI (no out-of-tree wiring)"
  fi
fi

echo ""
echo "passed: $pass  failed: $fail"
[ "$fail" -eq 0 ]
