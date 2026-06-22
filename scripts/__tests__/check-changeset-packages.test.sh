#!/usr/bin/env bash
# Unit tests for scripts/check-changeset-packages.sh — the changeset
# package-name gate — plus a structural assertion that the gate's suite is wired
# into ci.yml's required `lockfile-sync-tests` ("CI Self-Defense Tests") job.
#
# WHY THIS GATE EXISTS
# --------------------
# A changeset whose YAML front-matter names a package that is NOT a versionable
# workspace (most often the root "spawnforge", or a typo like "@spawnforge/web")
# makes `changeset version` throw "Found changeset <name> for package <pkg> which
# is not in the workspace" during release-plan assembly, latently breaking the
# Release workflow. That defect shipped to main THREE times (#8325 -> #8396 ->
# #8732). The pre-existing changeset-check gate only verified that *a* changeset
# was added — it never validated the package name. This gate is the durable
# recurrence guard, so an untested exit-code regression here would re-open the
# exact hole the gate was built to close.
#
# HERMETIC TESTING
# ----------------
# The gate resolves its repo root from its own location
# ($(dirname BASH_SOURCE)/..) and reads package.json + .changeset/ relative to
# it — there is no env seam. So each case builds a throwaway repo, COPIES the
# real gate into <repo>/scripts/, and runs THAT copy: its repo_root then resolves
# to the throwaway tree. The gate shells out to `node` to read workspace
# package.json names, so node is required (guarded below); it touches no network
# and mutates nothing outside the temp dir.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../check-changeset-packages.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
FAILURES=0

pass() { echo "  PASS: $1"; }
fail() { echo "  FAIL: $1"; FAILURES=$((FAILURES + 1)); }

[ -f "$SCRIPT" ] || { echo "gate script not found: $SCRIPT"; exit 1; }
command -v node >/dev/null 2>&1 || { echo "node not found — required to run these tests"; exit 1; }

# Build a throwaway repo with the standard four-workspace layout and a copy of
# the real gate at <repo>/scripts/. Echoes the repo path; the caller writes
# .changeset/*.md fixtures into it. No `git init` needed — the gate uses no git.
make_repo() {
  local repo
  repo="$(mktemp -d)"
  mkdir -p "$repo/scripts" "$repo/.changeset" \
           "$repo/web" "$repo/mcp-server" "$repo/packages/ui" "$repo/apps/docs"
  cp "$SCRIPT" "$repo/scripts/check-changeset-packages.sh"
  printf '%s' '{"workspaces":["web","mcp-server","packages/*","apps/*"]}' > "$repo/package.json"
  printf '%s' '{"name":"web"}'                    > "$repo/web/package.json"
  printf '%s' '{"name":"@project-forge/mcp-server"}' > "$repo/mcp-server/package.json"
  printf '%s' '{"name":"@spawnforge/ui"}'         > "$repo/packages/ui/package.json"
  printf '%s' '{"name":"@spawnforge/docs"}'       > "$repo/apps/docs/package.json"
  echo "$repo"
}

# write_changeset <repo> <name> <body...> — write .changeset/<name>.md verbatim.
write_changeset() { printf '%s' "$3" > "$1/.changeset/$2.md"; }

# Run the gate inside <repo>; echo "<exit>|<output>".
run_gate() {
  local repo="$1" out rc
  out="$(bash "$repo/scripts/check-changeset-packages.sh" 2>&1)"
  rc=$?
  printf '%s|%s' "$rc" "$out"
}

echo "=== check-changeset-packages.sh tests ==="

# --- 1. Valid single-package changeset -> exit 0 + success message ------------
repo="$(make_repo)"
write_changeset "$repo" good $'---\n"web": patch\n---\n\nA fix.\n'
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "valid \"web\" changeset passes (exit 0)"; else fail "valid changeset should exit 0, got $rc ($out)"; fi
if grep -qi "valid workspace packages" <<<"$out"; then pass "success message names the verdict"; else fail "success message missing"; fi
rm -rf "$repo"

# --- 2. Valid MULTI-package changeset (one file, two keys) -> exit 0 ----------
# The security relock changeset targets both "web" and the mcp-server package;
# both must be accepted from a single front-matter block.
repo="$(make_repo)"
write_changeset "$repo" multi $'---\n"web": patch\n"@project-forge/mcp-server": patch\n---\n\nRelock.\n'
res="$(run_gate "$repo")"; rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "valid multi-package changeset passes (exit 0)"; else fail "multi-package changeset should exit 0, got $rc"; fi
rm -rf "$repo"

# --- 3. Non-workspace package (the #8732 defect) -> exit 1 + names it ---------
# The exact recurring bug: a changeset for the root "spawnforge" package, which
# is NOT in `workspaces`, so `changeset version` would throw at release time.
repo="$(make_repo)"
write_changeset "$repo" bad $'---\n"spawnforge": patch\n---\n\nOops.\n'
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "non-workspace \"spawnforge\" fails (exit 1)"; else fail "non-workspace package should exit 1, got $rc"; fi
if grep -qF 'spawnforge' <<<"$out"; then pass "failure names the offending package"; else fail "failure does not name the package"; fi
if grep -qF '::error file=' <<<"$out"; then pass "failure emits an ::error file= annotation"; else fail "no ::error file= annotation"; fi
rm -rf "$repo"

# --- 4. Typo workspace name (@spawnforge/web) -> exit 1 -----------------------
# A near-miss of the real "web" / "@spawnforge/ui" names must still be rejected.
repo="$(make_repo)"
write_changeset "$repo" typo $'---\n"@spawnforge/web": patch\n---\n\nTypo.\n'
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "typo name @spawnforge/web fails (exit 1)"; else fail "typo name should exit 1, got $rc"; fi
if grep -qF '@spawnforge/web' <<<"$out"; then pass "failure names the typo package"; else fail "failure does not name the typo"; fi
rm -rf "$repo"

# --- 5. Bare (unquoted) YAML key -> exit 0 -----------------------------------
# changesets emit `pkg: bump` as well as quoted forms; the bare style must parse.
repo="$(make_repo)"
write_changeset "$repo" bare $'---\nweb: patch\n---\n\nBare key.\n'
res="$(run_gate "$repo")"; rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "bare unquoted key web: patch passes (exit 0)"; else fail "bare key should exit 0, got $rc"; fi
rm -rf "$repo"

# --- 6. Single-quoted YAML key -> exit 0 -------------------------------------
repo="$(make_repo)"
write_changeset "$repo" sq $'---\n\x27web\x27: patch\n---\n\nSingle-quoted.\n'
res="$(run_gate "$repo")"; rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "single-quoted key passes (exit 0)"; else fail "single-quoted key should exit 0, got $rc"; fi
rm -rf "$repo"

# --- 7. Prose `---` rule + the word "spawnforge" in the BODY -> exit 0 --------
# The front-matter parser must close at the SECOND `---` (the closing fence) and
# never read the body. A horizontal rule or the literal "spawnforge" in prose
# must NOT be misparsed as a package — the whole reason the gate scans only the
# front-matter. This also exercises the BSD/macOS-sed no-backreference path.
repo="$(make_repo)"
write_changeset "$repo" prose $'---\n"web": patch\n---\n\nThis mentions spawnforge in prose.\n\n---\n\nText after a horizontal rule: "@spawnforge/web".\n'
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "0" ]; then pass "prose ---/spawnforge in body is not misparsed (exit 0)"; else fail "body content leaked into parse, got $rc ($out)"; fi
rm -rf "$repo"

# --- 8. No front-matter at all -> exit 0 (silently passes) -------------------
# A file whose first line is not `---` declares no package; the gate's job is to
# reject WRONG names, not to police malformed files (the upstream existence check
# owns that). It must not invent a package from prose.
repo="$(make_repo)"
write_changeset "$repo" nofm $'Just prose, no front matter.\nspawnforge appears here but is not a key.\n'
res="$(run_gate "$repo")"; rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "no-front-matter file passes without inventing a package (exit 0)"; else fail "no-front-matter should exit 0, got $rc"; fi
rm -rf "$repo"

# --- 9. Empty .changeset/ (only README.md) -> exit 0 -------------------------
# `shopt -s nullglob` makes the glob expand to nothing; the loop is a no-op.
repo="$(make_repo)"
printf '%s' '# Changesets' > "$repo/.changeset/README.md"
res="$(run_gate "$repo")"; rc="${res%%|*}"
if [ "$rc" = "0" ]; then pass "empty .changeset/ (README only) passes (exit 0)"; else fail "empty .changeset/ should exit 0, got $rc"; fi
rm -rf "$repo"

# --- 10. One valid + one invalid changeset -> exit 1 (invalid wins) ----------
# A good changeset must not mask a sibling bad one; the gate must scan all files.
repo="$(make_repo)"
write_changeset "$repo" ok    $'---\n"web": patch\n---\n\nGood.\n'
write_changeset "$repo" alsobad $'---\n"spawnforge": patch\n---\n\nBad.\n'
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "a bad changeset alongside a good one still fails (exit 1)"; else fail "mixed good/bad should exit 1, got $rc"; fi
if grep -qF 'spawnforge' <<<"$out"; then pass "the bad sibling is named in the failure"; else fail "bad sibling not reported"; fi
rm -rf "$repo"

# --- 11. Fail-closed: no resolvable workspace names -> exit 1 ----------------
# An empty `workspaces` (or a node failure leaving zero names) must REFUSE to
# pass vacuously — otherwise every package name would be "invalid" yet the gate
# would have nothing to compare against. The guard exits 1 BEFORE scanning.
repo="$(make_repo)"
printf '%s' '{"workspaces":[]}' > "$repo/package.json"
write_changeset "$repo" any $'---\n"web": patch\n---\n\nWhatever.\n'
res="$(run_gate "$repo")"; rc="${res%%|*}"; out="${res#*|}"
if [ "$rc" = "1" ]; then pass "unresolvable workspace names fail closed (exit 1)"; else fail "empty workspaces should exit 1, got $rc"; fi
if grep -qi "could not resolve any workspace" <<<"$out"; then pass "fail-closed message explains the refusal"; else fail "fail-closed message missing"; fi
rm -rf "$repo"

echo ""
echo "=== ci.yml integration wiring ==="
# Every other check-*.sh gate's suite runs in the lockfile-sync-tests ("CI
# Self-Defense Tests") job, which rides ci-success and so is REQUIRED. Pin that
# this gate's suite is wired there too (shellchecked AND executed) so a future
# edit cannot silently demote it to advisory-only. This gate's WORKFLOW
# (changeset-check.yml) is standalone — not in ci-success — which is why there is
# no ci-success anti-tamper entry to assert (cf. the openapi gate); only the TEST
# suite must be a required check.
if [ -f "$CI_YML" ]; then
  lst_block="$(awk '/^  lockfile-sync-tests:/{f=1} f{print} f && /^  [a-z][a-z-]*:/ && !/^  lockfile-sync-tests:/{exit}' "$CI_YML")"
  if grep -qF 'scripts/check-changeset-packages.sh scripts/__tests__/check-changeset-packages.test.sh' <<<"$lst_block" \
     || { grep -qF 'scripts/check-changeset-packages.sh' <<<"$lst_block" && grep -qF 'scripts/__tests__/check-changeset-packages.test.sh' <<<"$lst_block"; }; then
    pass "lockfile-sync-tests shellchecks the gate + its suite"
  else
    fail "lockfile-sync-tests does not shellcheck check-changeset-packages.sh + its test"
  fi
  if grep -qF 'bash scripts/__tests__/check-changeset-packages.test.sh' <<<"$lst_block"; then
    pass "lockfile-sync-tests runs the changeset-packages gate suite"
  else
    fail "lockfile-sync-tests does not run the changeset-packages gate suite (self-tests not required)"
  fi
else
  fail "ci.yml not found at $CI_YML"
fi

echo ""
if [ "$FAILURES" -eq 0 ]; then
  echo "All tests passed."
  exit 0
else
  echo "$FAILURES test(s) failed."
  exit 1
fi
