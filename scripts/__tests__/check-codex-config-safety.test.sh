#!/usr/bin/env bash
# Contract test for scripts/check-codex-config-safety.sh — the Codex permissive-
# profile tripwire.
#
# WHY THIS GATE EXISTS
# The *committed* `.codex/config.toml` on main is the safe, approval-gated profile
# every contributor inherits on pull. A fully-unattended profile — `approval_policy
# = "never"` together with `network_access = true` (and shell_tool on) — lets a
# Codex agent run arbitrary shell with no human gate AND reach the network: a
# silent, high-blast-radius supply-chain footgun if it were ever committed. The
# agentic-toolkit parity review (gap Settings#0) called for a pure defense-in-depth
# guard: pass on the safe HEAD, fail only if a permissive profile is COMMITTED.
#
# CRITICAL SAFETY CONTRACT — the guard reads the COMMITTED blob, never the working
# tree. The dangerous profile exists in this engagement only as an OFF-LIMITS,
# uncommitted local edit; a guard that read the working-tree file would (a) read an
# off-limits file and (b) false-fail locally while HEAD is safe. So the production
# path is `git show HEAD:.codex/config.toml`. Two test seams keep the suite
# hermetic and prove both behaviors:
#   * CODEX_CONFIG_PATH=<file>      — read this fixture directly, bypass git.
#   * CODEX_CONFIG_SCAN_ROOT=<dir>  — `git -C <dir> show HEAD:.codex/config.toml`.
#
# Exit 0 = safe/clean, exit 1 = a permissive committed profile — those two codes
# ARE the behavior, so cases assert on them directly. Assertions use explicit
# if/then/else (NOT `A && ok || bad`) so the suite is SC2015-clean for CI's
# self-defense lint job. grep is fed from here-strings (`<<<`), never
# `echo "$big" | grep` — that antipattern takes SIGPIPE under `pipefail` on Linux
# when the payload exceeds the pipe buffer (the bug fixed in #8687/#8696).
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GUARD="$REPO_ROOT/scripts/check-codex-config-safety.sh"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
CI_SUCCESS="$REPO_ROOT/scripts/check-ci-success.sh"

# --- host guards -------------------------------------------------------------
command -v grep   >/dev/null 2>&1 || { echo "FATAL: grep not found on host";   exit 1; }
command -v mktemp >/dev/null 2>&1 || { echo "FATAL: mktemp not found on host"; exit 1; }
command -v git    >/dev/null 2>&1 || { echo "FATAL: git not found on host";    exit 1; }

PASS=0
FAIL=0
ok()  { echo "  ok: $1"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

# --- fixture profiles --------------------------------------------------------
# Safe profile — mirrors the committed HEAD: approval-gated, network/shell off.
SAFE_TOML='model = "gpt-5.3-codex"
approval_policy = "unless-allow-listed"

[sandbox_workspace_write]
allow = ["**/*"]

[features]
shell_tool = false
web_search = false'

# The dangerous combination the guard MUST reject: unattended + network-open.
DANGER_TOML='model = "gpt-5.3-codex"
approval_policy = "never"

[sandbox_workspace_write]
allow = ["**/*"]
network_access = true

[features]
shell_tool = true'

# Single value present in isolation — each alone is NOT the dangerous combo.
ONLY_NEVER='approval_policy = "never"

[sandbox_workspace_write]
network_access = false'
ONLY_NETWORK='approval_policy = "unless-allow-listed"

[sandbox_workspace_write]
network_access = true'

# Both dangerous keys, but COMMENTED OUT — must not count as active.
COMMENTED='# approval_policy = "never"
[sandbox_workspace_write]
  # network_access = true
approval_policy = "on-request"'

# Single-quoted "never" + whitespace-free network_access — both still active.
SINGLE_QUOTED="approval_policy = 'never'
[sandbox_workspace_write]
network_access=true"

# Trailing comments after each value — still active, must trip.
TRAILING_COMMENT='approval_policy = "never"   # fully unattended
[sandbox_workspace_write]
network_access = true  # open the network'

# No spaces around = — must trip.
NO_SPACE='approval_policy="never"
[sandbox_workspace_write]
network_access=true'

# Near-misses: look like the dangerous tokens but are not them → must pass.
NEAR_MISS='approval_policy = "never-mind"
[sandbox_workspace_write]
network_access = truely'

# Inline-table TOML forms place a key mid-line after `{` or `,`. Inline tables are
# semantically identical to [section] tables in TOML 1.0, so the dangerous combo
# expressed this way MUST still trip — the line anchor alone would miss it.
INLINE_NETWORK='approval_policy = "never"
sandbox_workspace_write = { network_access = true }'
INLINE_BOTH='settings = { approval_policy = "never", network_access = true }'
INLINE_NO_SPACE='approval_policy="never"
s={network_access=true}'

# Triple-quoted basic ("""…""") and literal ('''…''') strings are semantically
# identical to their single-delimited forms in TOML 1.0, so a triple-quoted never
# must trip just like "never".
TRIPLE_DOUBLE='approval_policy = """never"""
[sandbox_workspace_write]
network_access = true'
TRIPLE_SINGLE="approval_policy = '''never'''
[sandbox_workspace_write]
network_access = true"

# A TRUE multi-line triple-quoted approval_policy (value on its own line) is OUT
# OF SCOPE and must pass: TOML preserves the embedded newlines, so the parsed
# value is "\nnever\n" — not the token `never` — so it is not a functional
# permissive setting and Codex would not read it as one. This pins that documented
# boundary so the single-line coverage is never mistaken for multi-line coverage.
TRIPLE_MULTILINE_OOS='approval_policy = """
never
"""
[sandbox_workspace_write]
network_access = true'

# Uppercase TRUE is NOT a TOML boolean (booleans are lowercase), so the guard must
# treat it as a near-miss and pass — pins the case-sensitivity boundary so a future
# case-insensitive relaxation cannot silently widen the match.
NEAR_MISS_UPPERCASE='approval_policy = "never"
[sandbox_workspace_write]
network_access = TRUE'

# Inline-table near-miss: network_access=true is active but approval_policy is the
# benign "never-mind", so the dangerous combo is NOT present → must pass. Proves
# the relaxed key-boundary still requires the EXACT never token inside inline tables.
INLINE_NEAR_MISS='settings = { approval_policy = "never-mind", network_access = true }'

# A fully-commented inline table is inactive (whole-line comment) → must pass.
INLINE_COMMENTED='# settings = { approval_policy = "never", network_access = true }
approval_policy = "on-request"'

run_fixture() { # <content> → writes a fixture file, runs the guard against it
  local content="$1" tmp rc
  tmp="$(mktemp)"
  printf '%s\n' "$content" > "$tmp"
  CODEX_CONFIG_PATH="$tmp" bash "$GUARD" >/dev/null 2>&1
  rc=$?
  rm -f "$tmp"
  return "$rc"
}
run_fixture_out() { # <content> → echoes the guard's combined output
  local content="$1" tmp
  tmp="$(mktemp)"
  printf '%s\n' "$content" > "$tmp"
  CODEX_CONFIG_PATH="$tmp" bash "$GUARD" 2>&1
  rm -f "$tmp"
}

# =============================================================================
echo "== tripwire: script exists and is executable =="
if [ -f "$GUARD" ] && [ -x "$GUARD" ]; then ok "guard script present and executable"; else bad "guard script missing or not executable: $GUARD"; fi

# =============================================================================
echo "== safe committed profile (approval-gated, network off) passes =="
run_fixture "$SAFE_TOML"; rc=$?
if [ "$rc" -eq 0 ]; then ok "safe profile → exit 0"; else bad "safe profile should pass, got exit $rc"; fi

# =============================================================================
echo "== dangerous combo (never + network_access=true) fails =="
run_fixture "$DANGER_TOML"; rc=$?
if [ "$rc" -eq 1 ]; then ok "never + network_access=true → exit 1"; else bad "dangerous combo should fail, got exit $rc"; fi

# =============================================================================
echo "== each dangerous key ALONE is not the combo → passes =="
run_fixture "$ONLY_NEVER"; rc=$?
if [ "$rc" -eq 0 ]; then ok "approval_policy=never alone (network off) → exit 0"; else bad "never-only should pass, got exit $rc"; fi
run_fixture "$ONLY_NETWORK"; rc=$?
if [ "$rc" -eq 0 ]; then ok "network_access=true alone (approval gated) → exit 0"; else bad "network-only should pass, got exit $rc"; fi

# =============================================================================
echo "== commented-out dangerous keys do not count =="
run_fixture "$COMMENTED"; rc=$?
if [ "$rc" -eq 0 ]; then ok "commented never + network_access → exit 0"; else bad "commented keys should pass, got exit $rc"; fi

# =============================================================================
echo "== quoting / whitespace / trailing-comment variants of the combo all trip =="
run_fixture "$SINGLE_QUOTED"; rc=$?
if [ "$rc" -eq 1 ]; then ok "single-quoted 'never' + network_access=true → exit 1"; else bad "single-quoted combo should fail, got exit $rc"; fi
run_fixture "$TRAILING_COMMENT"; rc=$?
if [ "$rc" -eq 1 ]; then ok "trailing-comment combo → exit 1"; else bad "trailing-comment combo should fail, got exit $rc"; fi
run_fixture "$NO_SPACE"; rc=$?
if [ "$rc" -eq 1 ]; then ok "no-space combo → exit 1"; else bad "no-space combo should fail, got exit $rc"; fi

# =============================================================================
echo "== near-miss tokens (never-mind / truely) do not trip =="
run_fixture "$NEAR_MISS"; rc=$?
if [ "$rc" -eq 0 ]; then ok "never-mind + truely → exit 0 (exact-token match only)"; else bad "near-miss tokens should pass, got exit $rc"; fi

# =============================================================================
echo "== inline-table TOML forms of the combo trip (key not at line start) =="
run_fixture "$INLINE_NETWORK"; rc=$?
if [ "$rc" -eq 1 ]; then ok "never + inline { network_access = true } → exit 1"; else bad "inline-table network combo should fail, got exit $rc"; fi
run_fixture "$INLINE_BOTH"; rc=$?
if [ "$rc" -eq 1 ]; then ok "inline { approval_policy=never, network_access=true } → exit 1"; else bad "inline-table both-keys combo should fail, got exit $rc"; fi
run_fixture "$INLINE_NO_SPACE"; rc=$?
if [ "$rc" -eq 1 ]; then ok "no-space inline {network_access=true} + never → exit 1"; else bad "no-space inline combo should fail, got exit $rc"; fi

# =============================================================================
echo "== triple-quoted never (basic & literal) trips =="
run_fixture "$TRIPLE_DOUBLE"; rc=$?
if [ "$rc" -eq 1 ]; then ok 'approval_policy = """never""" + network → exit 1'; else bad "triple-double-quoted never should fail, got exit $rc"; fi
run_fixture "$TRIPLE_SINGLE"; rc=$?
if [ "$rc" -eq 1 ]; then ok "approval_policy = '''never''' + network → exit 1"; else bad "triple-single-quoted never should fail, got exit $rc"; fi
run_fixture "$TRIPLE_MULTILINE_OOS"; rc=$?
if [ "$rc" -eq 0 ]; then ok 'multi-line """\n never \n""" parses to a newline value, not the token never → out of scope, exit 0'; else bad "multi-line triple-quoted never is out of scope and should pass, got exit $rc"; fi

# =============================================================================
echo "== case-sensitivity & inline near-misses do not trip =="
run_fixture "$NEAR_MISS_UPPERCASE"; rc=$?
if [ "$rc" -eq 0 ]; then ok "network_access = TRUE (uppercase, not a TOML bool) → exit 0"; else bad "uppercase TRUE should pass, got exit $rc"; fi
run_fixture "$INLINE_NEAR_MISS"; rc=$?
if [ "$rc" -eq 0 ]; then ok "inline never-mind + network_access=true → exit 0 (exact token only)"; else bad "inline near-miss should pass, got exit $rc"; fi
run_fixture "$INLINE_COMMENTED"; rc=$?
if [ "$rc" -eq 0 ]; then ok "fully-commented inline table → exit 0"; else bad "commented inline table should pass, got exit $rc"; fi

# =============================================================================
echo "== missing / empty config = pass (nothing committed to reject) =="
CODEX_CONFIG_PATH="$(mktemp -u)" bash "$GUARD" >/dev/null 2>&1; rc=$?
if [ "$rc" -eq 0 ]; then ok "non-existent config path → exit 0"; else bad "missing config should pass, got exit $rc"; fi
empty="$(mktemp)"; : > "$empty"
CODEX_CONFIG_PATH="$empty" bash "$GUARD" >/dev/null 2>&1; rc=$?
if [ "$rc" -eq 0 ]; then ok "empty config → exit 0"; else bad "empty config should pass, got exit $rc"; fi
rm -f "$empty"

# =============================================================================
echo "== offender output names the file and labels the CODEX-PERMISSIVE class =="
out="$(run_fixture_out "$DANGER_TOML")"
if grep -q "CODEX-PERMISSIVE" <<<"$out"; then ok "output labels the CODEX-PERMISSIVE class"; else bad "output omits CODEX-PERMISSIVE label"; fi
if grep -q "approval_policy" <<<"$out"; then ok "output names approval_policy"; else bad "output omits approval_policy"; fi
if grep -q "network_access" <<<"$out"; then ok "output names network_access"; else bad "output omits network_access"; fi

# =============================================================================
echo "== SAFETY: reads the COMMITTED blob, never the working tree =="
# A repo whose HEAD commits the SAFE profile but whose working tree holds the
# DANGER profile (unstaged, mirroring the OFF-LIMITS local edit) MUST pass — the
# guard reads `git show HEAD:` and ignores the dirty working copy entirely.
gitroot="$(mktemp -d)"
(
  cd "$gitroot" || exit 1
  git init -q
  git config user.email t@e.x
  git config user.name t
  mkdir -p .codex
  printf '%s\n' "$SAFE_TOML" > .codex/config.toml
  git add .codex/config.toml
  git commit -qm "safe codex profile"
  # Now dirty the working tree with the dangerous profile — uncommitted.
  printf '%s\n' "$DANGER_TOML" > .codex/config.toml
)
CODEX_CONFIG_SCAN_ROOT="$gitroot" bash "$GUARD" >/dev/null 2>&1; rc=$?
if [ "$rc" -eq 0 ]; then ok "committed SAFE + working-tree DANGER → exit 0 (working tree ignored)"; else bad "guard read the working tree (got exit $rc) — must read HEAD only"; fi

# When the DANGER profile is actually COMMITTED, the same git-backed path trips.
(
  cd "$gitroot" || exit 1
  git add .codex/config.toml
  git commit -qm "permissive codex profile committed"
)
CODEX_CONFIG_SCAN_ROOT="$gitroot" bash "$GUARD" >/dev/null 2>&1; rc=$?
if [ "$rc" -eq 1 ]; then ok "committed DANGER profile → exit 1 (git-backed path)"; else bad "committed danger should fail via git path, got exit $rc"; fi
rm -rf "$gitroot"

# A git root with no committed .codex/config.toml at HEAD → pass (nothing to reject).
gitroot2="$(mktemp -d)"
(
  cd "$gitroot2" || exit 1
  git init -q
  git config user.email t@e.x
  git config user.name t
  printf 'placeholder\n' > README.md
  git add README.md
  git commit -qm "no codex config"
)
CODEX_CONFIG_SCAN_ROOT="$gitroot2" bash "$GUARD" >/dev/null 2>&1; rc=$?
if [ "$rc" -eq 0 ]; then ok "no committed .codex/config.toml → exit 0"; else bad "absent committed config should pass, got exit $rc"; fi
rm -rf "$gitroot2"

# =============================================================================
echo "== the REAL committed .codex/config.toml on this branch is safe =="
# Defense-in-depth's own baseline: the guard must pass against this very repo's
# committed config (no seam) — if it didn't, HEAD would already be permissive.
( cd "$REPO_ROOT" && bash "$GUARD" >/dev/null 2>&1 ); rc=$?
if [ "$rc" -eq 0 ]; then ok "guard passes against the repo's committed HEAD config"; else bad "guard fails on real HEAD config (got exit $rc) — HEAD permissive or guard broken"; fi

# =============================================================================
echo "== structural wiring: guard is a required, self-defending CI gate =="
if [ -f "$CI_YML" ]; then
  if grep -q "check-codex-config-safety.sh" "$CI_YML"; then
    ok "ci.yml invokes the guard"
  else
    bad "ci.yml does not invoke check-codex-config-safety.sh"
  fi
  if grep -Eq "codex-config-guard" "$CI_YML"; then
    ok "ci.yml defines the codex-config-guard job"
  else
    bad "ci.yml has no codex-config-guard job"
  fi
  # Must be a dependency of an aggregate (ci-success), not a free-floating check.
  if grep -Eq "^[[:space:]]*-[[:space:]]*codex-config-guard" "$CI_YML"; then
    ok "codex-config-guard is listed under a needs: block"
  else
    bad "codex-config-guard is not referenced as a needs: dependency"
  fi
  # The job's own `if:` must gate on the SAME ci-gate output the anti-tamper maps
  # it to (needs-codex). A name-only grep would pass even if the trigger were
  # silently rewired to a never-true output, leaving the gate dead while present.
  if grep -Eq "needs\.ci-gate\.outputs\.needs-codex == 'true'" "$CI_YML"; then
    ok "codex-config-guard job is gated on needs-codex (trigger wired)"
  else
    bad "codex-config-guard job is not gated on needs-codex"
  fi
  # The ci-gate must actually PRODUCE the needs-codex output the job consumes.
  if grep -Eq "needs-codex:" "$CI_YML"; then
    ok "ci-gate declares the needs-codex output"
  else
    bad "ci-gate has no needs-codex output"
  fi
  # The path filter must key on the .codex/config.toml literal. Every grep above
  # (job, needs:, if:, output) would stay green if a one-line edit dropped the
  # `^\.codex/config\.toml$` arm from the filter, silently skipping the gate on
  # its primary trigger path — so pin the literal trigger path itself.
  if grep -Eq "\.codex/config\.toml" "$CI_YML"; then
    ok "ci-gate path filter keys on the .codex/config.toml literal"
  else
    bad "ci.yml never references the .codex/config.toml path-filter literal"
  fi
else
  bad "ci.yml not found at $CI_YML"
fi

# The anti-tamper verifier must MAP THIS job to THIS trigger, not merely mention
# the string. Assert the exact check_triggered call so a dropped/renamed trigger
# arm (which would reopen the `if: false` skip vector) fails this suite.
if [ -f "$CI_SUCCESS" ]; then
  if grep -Eq 'check_triggered[[:space:]]+"codex-config-guard"[[:space:]]+"needs-codex"' "$CI_SUCCESS"; then
    ok "check-ci-success.sh maps codex-config-guard → needs-codex (exact anti-tamper wiring)"
  else
    bad "check-ci-success.sh does not map codex-config-guard to needs-codex"
  fi
else
  bad "check-ci-success.sh not found at $CI_SUCCESS"
fi

# =============================================================================
echo ""
echo "== summary =="
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -ne 0 ]; then exit 1; fi
exit 0
