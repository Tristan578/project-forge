#!/usr/bin/env bash
# Contract test for the cross-provider agentic-config source-of-truth gate:
#   * tools/agentic-sync/sync.mjs       — the generator (--check / --write)
#   * scripts/check-agentic-sync.sh     — the CI drift gate that wraps it
#
# Like the lockfile-sync suite, this drives the REAL scripts through their CLI
# contract against hermetic fixtures (an AGENTIC_SYNC_ROOT temp dir), so it needs
# no network and never mutates the repo's own instruction files. Exit 0 = in
# sync / wrote OK, exit 1 = drift or misconfiguration — those two codes ARE the
# behavior, so the cases assert on them directly. It also covers the fail-safe
# paths (malformed canonical.json, missing markers, missing target) that must
# report exit 1 rather than silently reading as "in sync", and asserts the gate
# is structurally wired into the required ci-success aggregate (so a one-line
# unwiring fails this suite, not just an advisory check).
#
# Assertions use explicit if/then/else (NOT `A && ok || bad`) so this suite has
# no SC2015 findings — CI's self-defense job lints it with shellcheck.
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
GEN="$REPO_ROOT/tools/agentic-sync/sync.mjs"
WRAPPER="$REPO_ROOT/scripts/check-agentic-sync.sh"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
CI_SUCCESS="$REPO_ROOT/scripts/check-ci-success.sh"

# --- host guards -------------------------------------------------------------
command -v node >/dev/null 2>&1 || { echo "FATAL: node not found on host"; exit 1; }
command -v mktemp >/dev/null 2>&1 || { echo "FATAL: mktemp not found on host"; exit 1; }

PASS=0
FAIL=0
ok()  { echo "  ok: $1"; PASS=$((PASS + 1)); }
bad() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

# Build a hermetic fixture root that mirrors the generator's expected layout:
#   <root>/tools/agentic-sync/canonical.json   (source of truth)
#   <root>/<target files with markers>
# Returns the root path on stdout.
make_fixture() {
  local root
  root="$(mktemp -d)"
  mkdir -p "$root/tools/agentic-sync" "$root/sub"
  cat > "$root/tools/agentic-sync/canonical.json" <<'JSON'
{
  "markerId": "AGENTIC-SYNC",
  "facts": {
    "taskboard": {
      "projectName": "Fixture Project",
      "projectId": "01TESTPROJECTID0000000000",
      "projectPrefix": "FX",
      "teams": { "Engineering": "01TESTENGTEAM00000000000" },
      "apiBaseUrl": "http://localhost:3010/api",
      "webUrl": "http://localhost:3010",
      "startCommand": "taskboard start --port 3010"
    },
    "versions": { "Next.js": "16.2.0" },
    "coverageThresholds": { "statements": 70, "branches": 60, "functions": 65, "lines": 72 },
    "quickValidation": "cd web && npx eslint --max-warnings 0 ."
  },
  "targets": ["AGENTS.md", "sub/copilot.md"]
}
JSON
  # Two targets with markers but NO inner content yet — --write will fill them.
  printf 'header line\n<!-- AGENTIC-SYNC:START -->\n<!-- AGENTIC-SYNC:END -->\nfooter line\n' > "$root/AGENTS.md"
  printf 'top\n<!-- AGENTIC-SYNC:START -->\nstale\n<!-- AGENTIC-SYNC:END -->\nbottom\n' > "$root/sub/copilot.md"
  echo "$root"
}

run_gen() { # <root> <mode...>  → runs the real generator against the fixture root
  local root="$1"; shift
  AGENTIC_SYNC_ROOT="$root" node "$GEN" "$@"
}

# =============================================================================
echo "== generator: file existence =="
if [ -f "$GEN" ]; then ok "generator $GEN exists"; else bad "generator $GEN missing"; fi
if [ -f "$WRAPPER" ]; then ok "wrapper $WRAPPER exists"; else bad "wrapper $WRAPPER missing"; fi
if [ -f "$REPO_ROOT/tools/agentic-sync/canonical.json" ]; then ok "real canonical.json exists"; else bad "real canonical.json missing"; fi

echo "== generator: --write then --check is in sync =="
ROOT="$(make_fixture)"
if run_gen "$ROOT" --write >/dev/null 2>&1; then ok "--write exits 0"; else bad "--write should exit 0"; fi
if run_gen "$ROOT" --check >/dev/null 2>&1; then ok "--check exits 0 after write"; else bad "--check should be in sync after write"; fi
if grep -q "01TESTPROJECTID0000000000" "$ROOT/AGENTS.md"; then ok "canonical projectId injected into AGENTS.md"; else bad "projectId not injected"; fi
if grep -q "01TESTPROJECTID0000000000" "$ROOT/sub/copilot.md"; then ok "canonical projectId injected into nested target"; else bad "projectId not injected into nested target"; fi
rm -rf "$ROOT"

echo "== generator: the version note is canonical-sourced, not hardcoded =="
# The 'wasm-bindgen must match Cargo.lock exactly' note is a project FACT, so it
# must live in canonical.json (facts.versionsNote), NOT be hardcoded in renderBlock.
# A fixture WHOSE canonical omits versionsNote must emit NO parenthetical note after
# the version list — otherwise a 5th provider target (added per CONTRIBUTING by
# editing canonical.json alone) would carry a wrong Cargo.lock annotation.
ROOT="$(make_fixture)"   # fixture canonical has versions but NO versionsNote
run_gen "$ROOT" --write >/dev/null 2>&1
if grep -q "Pinned versions:" "$ROOT/AGENTS.md"; then ok "version list rendered"; else bad "version list missing"; fi
if grep -q "must match Cargo.lock" "$ROOT/AGENTS.md"; then bad "hardcoded wasm-bindgen note leaked when canonical has no versionsNote"; else ok "no version note when canonical omits versionsNote"; fi
rm -rf "$ROOT"

echo "== generator: a canonical versionsNote is rendered verbatim =="
ROOT="$(make_fixture)"
perl -0pi -e 's/("versions": \{ "Next.js": "16.2.0" \},)/$1 "versionsNote": "PIN EXACTLY PER LOCKFILE",/' "$ROOT/tools/agentic-sync/canonical.json"
run_gen "$ROOT" --write >/dev/null 2>&1
if grep -q "PIN EXACTLY PER LOCKFILE" "$ROOT/AGENTS.md"; then ok "canonical versionsNote rendered into target"; else bad "versionsNote from canonical not rendered"; fi
rm -rf "$ROOT"

echo "== generator: --write is idempotent =="
ROOT="$(make_fixture)"
run_gen "$ROOT" --write >/dev/null 2>&1
sum1="$(cat "$ROOT/AGENTS.md" "$ROOT/sub/copilot.md" | shasum | awk '{print $1}')"
run_gen "$ROOT" --write >/dev/null 2>&1
sum2="$(cat "$ROOT/AGENTS.md" "$ROOT/sub/copilot.md" | shasum | awk '{print $1}')"
if [ "$sum1" = "$sum2" ]; then ok "second --write leaves files byte-identical"; else bad "--write is not idempotent"; fi
rm -rf "$ROOT"

echo "== generator: --check detects drift =="
ROOT="$(make_fixture)"
run_gen "$ROOT" --write >/dev/null 2>&1
# Corrupt the marked region of one target.
perl -0pi -e 's/01TESTPROJECTID0000000000/01TAMPERED0000000000000000/' "$ROOT/AGENTS.md"
if run_gen "$ROOT" --check >/dev/null 2>&1; then bad "--check should FAIL on drift"; else ok "--check exits non-zero on drift"; fi
rm -rf "$ROOT"

echo "== generator: fail-safe on missing markers =="
ROOT="$(make_fixture)"
printf 'no markers here at all\n' > "$ROOT/AGENTS.md"
if run_gen "$ROOT" --check >/dev/null 2>&1; then bad "missing markers must NOT read as in-sync"; else ok "missing markers → exit non-zero"; fi
rm -rf "$ROOT"

echo "== generator: fail-safe on malformed canonical.json =="
ROOT="$(make_fixture)"
printf '{ this is not valid json ' > "$ROOT/tools/agentic-sync/canonical.json"
if run_gen "$ROOT" --check >/dev/null 2>&1; then bad "malformed canonical.json must NOT read as in-sync"; else ok "malformed canonical.json → exit non-zero"; fi
rm -rf "$ROOT"

echo "== generator: fail-safe on MISSING canonical.json (absent, not malformed) =="
# A malformed canonical dies on JSON.parse; an ABSENT one must die earlier on the
# existsSync guard — not fall through to a crash or, worse, read as in-sync.
ROOT="$(make_fixture)"
rm -f "$ROOT/tools/agentic-sync/canonical.json"
miss_out="$(run_gen "$ROOT" --check 2>&1)"; miss_rc=$?
if [ "$miss_rc" -ne 0 ]; then ok "missing canonical.json → exit non-zero"; else bad "missing canonical.json must NOT read as in-sync"; fi
if echo "$miss_out" | grep -qi "canonical source not found"; then ok "missing canonical.json dies with a clear message"; else bad "missing canonical.json should report 'not found'"; fi
rm -rf "$ROOT"

echo "== generator: AGENTIC_SYNC_CANONICAL points the loader at an explicit path =="
# The explicit-canonical seam must be honored: relocate the canonical to a path
# the DEFAULT lookup (<root>/tools/agentic-sync/canonical.json) would miss, then
# prove --check still finds it via the env override. If the seam were ignored the
# default path is now absent → "not found" (exit 1), so exit 0 here is load-bearing.
ROOT="$(make_fixture)"
run_gen "$ROOT" --write >/dev/null 2>&1
cp "$ROOT/tools/agentic-sync/canonical.json" "$ROOT/alt-canonical.json"
rm -f "$ROOT/tools/agentic-sync/canonical.json"
if AGENTIC_SYNC_ROOT="$ROOT" AGENTIC_SYNC_CANONICAL="$ROOT/alt-canonical.json" node "$GEN" --check >/dev/null 2>&1; then
  ok "AGENTIC_SYNC_CANONICAL override is honored (exit 0 from a relocated canonical)"
else
  bad "AGENTIC_SYNC_CANONICAL override ignored — loader did not read the explicit path"
fi
rm -rf "$ROOT"

echo "== generator: fail-safe on a structurally-invalid canonical (each validation arm) =="
# loadCanonical() rejects a parseable-but-wrong-shaped canonical rather than
# rendering a garbage block. Each arm must die (exit non-zero), never read green.
structural_case() { # <label> <json>
  local label="$1" json="$2" rc ROOT
  ROOT="$(make_fixture)"
  printf '%s' "$json" > "$ROOT/tools/agentic-sync/canonical.json"
  AGENTIC_SYNC_ROOT="$ROOT" node "$GEN" --check >/dev/null 2>&1; rc=$?
  if [ "$rc" -ne 0 ]; then ok "structural reject: $label → exit non-zero"; else bad "structural reject: $label must NOT read as in-sync"; fi
  rm -rf "$ROOT"
}
structural_case "empty object (no markerId)"      '{}'
structural_case "missing markerId"                '{"facts":{},"targets":["AGENTS.md"]}'
structural_case "empty markerId"                  '{"markerId":"","facts":{},"targets":["AGENTS.md"]}'
structural_case "missing facts"                   '{"markerId":"X","targets":["AGENTS.md"]}'
structural_case "facts not an object"             '{"markerId":"X","facts":"nope","targets":["AGENTS.md"]}'
structural_case "targets null"                    '{"markerId":"X","facts":{},"targets":null}'
structural_case "targets empty array"             '{"markerId":"X","facts":{},"targets":[]}'
structural_case "targets contains empty string"   '{"markerId":"X","facts":{},"targets":[""]}'
structural_case "targets contains non-string"     '{"markerId":"X","facts":{},"targets":[123]}'

echo "== generator: rejects a markerId carrying comment/space syntax =="
# markerId is interpolated raw into the literal marker comments (<!-- ID:START -->).
# A value with spaces or HTML-comment syntax could break or forge markers, so
# loadCanonical must reject it with a CLEAR markerId message — not let it through
# to render markers that then mysteriously 'miss' with a generic error.
ROOT="$(make_fixture)"
perl -0pi -e 's/"markerId": "AGENTIC-SYNC"/"markerId": "BAD MARKER"/' "$ROOT/tools/agentic-sync/canonical.json"
mk_out="$(AGENTIC_SYNC_ROOT="$ROOT" node "$GEN" --check 2>&1)"; mk_rc=$?
if [ "$mk_rc" -ne 0 ]; then ok "invalid markerId → exit non-zero"; else bad "invalid markerId must not read as in-sync"; fi
if echo "$mk_out" | grep -qi "markerId must"; then ok "invalid markerId dies with a clear markerId message"; else bad "invalid markerId should report a markerId validation error, not a generic miss"; fi
rm -rf "$ROOT"

echo "== generator: fail-safe on missing target file =="
ROOT="$(make_fixture)"
rm -f "$ROOT/sub/copilot.md"
if run_gen "$ROOT" --check >/dev/null 2>&1; then bad "missing target must NOT read as in-sync"; else ok "missing target → exit non-zero"; fi
rm -rf "$ROOT"

echo "== generator: fail-safe on misordered markers (END before START) =="
# inject() must reject a target whose END marker precedes its START marker rather
# than silently producing an empty/garbled region that could read as in-sync.
ROOT="$(make_fixture)"
printf 'top\n<!-- AGENTIC-SYNC:END -->\n<!-- AGENTIC-SYNC:START -->\nbottom\n' > "$ROOT/AGENTS.md"
if run_gen "$ROOT" --check >/dev/null 2>&1; then bad "misordered markers must NOT read as in-sync"; else ok "misordered markers → exit non-zero"; fi
rm -rf "$ROOT"

echo "== generator: fail-safe on a duplicate START marker before END =="
# Two START markers in one span is an ambiguous region; inject() must reject it.
ROOT="$(make_fixture)"
printf 'top\n<!-- AGENTIC-SYNC:START -->\n<!-- AGENTIC-SYNC:START -->\n<!-- AGENTIC-SYNC:END -->\nbottom\n' > "$ROOT/AGENTS.md"
if run_gen "$ROOT" --check >/dev/null 2>&1; then bad "duplicate START marker must NOT read as in-sync"; else ok "duplicate START marker → exit non-zero"; fi
rm -rf "$ROOT"

echo "== generator: fail-safe on a duplicate END marker after the block =="
# A second END marker after the block is as ambiguous as a duplicate START before
# it. Without a guard, inject() terminates at the FIRST END on --write (exit 0) and
# silently strands the trailing END in the footer — a quiet corruption. inject()
# must reject it on --write, not 'succeed'.
ROOT="$(make_fixture)"
printf 'top\n<!-- AGENTIC-SYNC:START -->\n<!-- AGENTIC-SYNC:END -->\nmid\n<!-- AGENTIC-SYNC:END -->\nbottom\n' > "$ROOT/AGENTS.md"
if run_gen "$ROOT" --write >/dev/null 2>&1; then bad "duplicate END marker must be rejected on --write, not silently injected"; else ok "duplicate END marker → --write exits non-zero"; fi
rm -rf "$ROOT"

echo "== generator: a marker sentinel embedded in a fact value cannot corrupt the target =="
# A fact value carrying the END sentinel must NOT leak a second END marker into the
# rendered block — that would terminate the managed span early and corrupt the
# footer on the next run. renderBlock strips HTML comments from interpolated values,
# so the target keeps exactly ONE END marker and --check stays idempotent.
ROOT="$(make_fixture)"
perl -0pi -e 's/"projectName": "Fixture Project"/"projectName": "Fixture <!-- AGENTIC-SYNC:END --> Project"/' "$ROOT/tools/agentic-sync/canonical.json"
run_gen "$ROOT" --write >/dev/null 2>&1
end_count="$(grep -c "AGENTIC-SYNC:END" "$ROOT/AGENTS.md")"
if [ "$end_count" -eq 1 ]; then ok "exactly one END marker after write (sentinel in fact value stripped)"; else bad "fact-value sentinel leaked a second END marker (count=$end_count)"; fi
if run_gen "$ROOT" --check >/dev/null 2>&1; then ok "sentinel-in-value target is stable on --check"; else bad "sentinel-in-value corrupted the target (drift/throw on --check)"; fi
rm -rf "$ROOT"

echo "== generator: a NESTED comment sentinel cannot survive sanitization =="
# Single-pass paired-comment removal can CREATE a fresh comment opener from the
# surrounding bytes: stripping '<!-- x -->' out of '<!<!-- x -->-- ID:END -->'
# splices the leading '<!' onto the trailing '--', leaving a live
# '<!-- AGENTIC-SYNC:END -->' sentinel in the rendered block (CodeQL
# js/incomplete-multi-character-sanitization). The sanitizer must strip to a
# fixed point so neither '<!--' nor '-->' can survive in an interpolated value.
ROOT="$(make_fixture)"
perl -0pi -e 's/"projectName": "Fixture Project"/"projectName": "Fixture <!<!-- x -->-- AGENTIC-SYNC:END --> Project"/' "$ROOT/tools/agentic-sync/canonical.json"
run_gen "$ROOT" --write >/dev/null 2>&1
# Count the FUNCTIONAL sentinel (full comment form) — inject() only recognizes
# `<!-- AGENTIC-SYNC:END -->` lines, so de-fanged bare text is harmless residue.
end_count="$(grep -cF -- '<!-- AGENTIC-SYNC:END -->' "$ROOT/AGENTS.md")"
if [ "$end_count" -eq 1 ]; then ok "exactly one END marker after write (nested sentinel neutralized)"; else bad "nested comment sentinel leaked a second END marker (count=$end_count)"; fi
if grep "Fixture" "$ROOT/AGENTS.md" | grep -q -e '<!--' -e '-->'; then
  bad "interpolated value still contains a comment token after sanitization"
else
  ok "interpolated value carries no '<!--' or '-->' residue"
fi
if run_gen "$ROOT" --check >/dev/null 2>&1; then ok "nested-sentinel target is stable on --check"; else bad "nested sentinel corrupted the target (drift/throw on --check)"; fi
rm -rf "$ROOT"

echo "== generator: the malformed '--!>' comment close cannot survive sanitization =="
# HTML parsers also accept '--!>' as a comment close (CodeQL js/bad-tag-filter:
# comment-matching regexes that only handle '-->' are bypassable via '--!>').
# The sanitizer strips the raw tokens '<!--', '-->', AND '--!>' to a fixed
# point, so a value mixing all three forms must leave no token residue and
# exactly one functional END sentinel in the target.
ROOT="$(make_fixture)"
perl -0pi -e 's/"projectName": "Fixture Project"/"projectName": "Fixture <!--!> <!-- x --!> AGENTIC-SYNC:END --!>-- --> Project"/' "$ROOT/tools/agentic-sync/canonical.json"
run_gen "$ROOT" --write >/dev/null 2>&1
end_count="$(grep -cF -- '<!-- AGENTIC-SYNC:END -->' "$ROOT/AGENTS.md")"
if [ "$end_count" -eq 1 ]; then ok "exactly one END marker after write ('--!>' variant neutralized)"; else bad "'--!>' sentinel variant leaked a second END marker (count=$end_count)"; fi
if grep "Fixture" "$ROOT/AGENTS.md" | grep -q -e '<!--' -e '-->' -e '--!>'; then
  bad "interpolated value still contains a comment token ('<!--', '-->', or '--!>') after sanitization"
else
  ok "interpolated value carries no '<!--', '-->', or '--!>' residue"
fi
if run_gen "$ROOT" --check >/dev/null 2>&1; then ok "'--!>'-variant target is stable on --check"; else bad "'--!>' variant corrupted the target (drift/throw on --check)"; fi
rm -rf "$ROOT"

echo "== generator: fail-safe on a path-traversal target (must not escape repo root) =="
# A canonical.json whose targets[] points OUTSIDE the root (../secret.md) must be
# refused, not silently followed. A vulnerable generator would `join(ROOT, rel)`,
# find the out-of-root file (it has valid markers here), and rewrite it on --write.
PARENT="$(mktemp -d)"
ESCAPE_ROOT="$PARENT/repo"
mkdir -p "$ESCAPE_ROOT/tools/agentic-sync"
cat > "$ESCAPE_ROOT/tools/agentic-sync/canonical.json" <<'JSON'
{
  "markerId": "AGENTIC-SYNC",
  "facts": { "taskboard": { "projectName": "Escape", "projectId": "01X", "projectPrefix": "X" } },
  "targets": ["../secret.md"]
}
JSON
printf 'secret top\n<!-- AGENTIC-SYNC:START -->\n<!-- AGENTIC-SYNC:END -->\nsecret bottom\n' > "$PARENT/secret.md"
before_secret="$(shasum "$PARENT/secret.md" | awk '{print $1}')"
if AGENTIC_SYNC_ROOT="$ESCAPE_ROOT" node "$GEN" --write >/dev/null 2>&1; then
  bad "--write with a ../ traversal target must exit non-zero (refuse to escape root)"
else
  ok "--write refuses a path-traversal target (exit non-zero)"
fi
after_secret="$(shasum "$PARENT/secret.md" | awk '{print $1}')"
if [ "$before_secret" = "$after_secret" ]; then ok "out-of-root file left unmodified"; else bad "generator mutated a file outside the repo root"; fi
rm -rf "$PARENT"

echo "== generator: fail-safe on a SYMLINKED target escaping repo root =="
# path.resolve() is lexical and does NOT follow symlinks, but readFileSync /
# writeFileSync do. A symlink planted at an in-root target path but pointing
# OUTSIDE the root would pass a purely-lexical guard, and --write would overwrite
# the out-of-root file. The guard must resolve the symlink (realpath) and refuse.
PARENT="$(mktemp -d)"
SROOT="$PARENT/repo"
mkdir -p "$SROOT/tools/agentic-sync"
cat > "$SROOT/tools/agentic-sync/canonical.json" <<'JSON'
{
  "markerId": "AGENTIC-SYNC",
  "facts": { "taskboard": { "projectName": "Sym", "projectId": "01X", "projectPrefix": "X" } },
  "targets": ["AGENTS.md"]
}
JSON
printf 'secret top\n<!-- AGENTIC-SYNC:START -->\n<!-- AGENTIC-SYNC:END -->\nsecret bottom\n' > "$PARENT/secret.md"
ln -s "$PARENT/secret.md" "$SROOT/AGENTS.md"
before_sym="$(shasum "$PARENT/secret.md" | awk '{print $1}')"
if AGENTIC_SYNC_ROOT="$SROOT" node "$GEN" --write >/dev/null 2>&1; then
  bad "--write through an out-of-root symlink target must exit non-zero"
else
  ok "--write refuses a symlinked-escape target (exit non-zero)"
fi
after_sym="$(shasum "$PARENT/secret.md" | awk '{print $1}')"
if [ "$before_sym" = "$after_sym" ]; then ok "symlinked out-of-root file left unmodified"; else bad "generator wrote through a symlink escaping root"; fi
rm -rf "$PARENT"

echo "== generator: fail-safe on a target resolving to the repo root itself =="
# A target of "." resolves exactly to ROOT. It must die() with a clear message,
# not short-circuit the guard and fall through to an unhandled EISDIR crash.
ROOT="$(make_fixture)"
perl -0pi -e 's/"targets": \[[^]]*\]/"targets": ["."]/' "$ROOT/tools/agentic-sync/canonical.json"
root_out="$(AGENTIC_SYNC_ROOT="$ROOT" node "$GEN" --check 2>&1 || true)"
if echo "$root_out" | grep -qi "escapes repo root"; then ok "ROOT-itself target dies cleanly with a clear message"; else bad "ROOT-itself target must die() cleanly, not crash"; fi
rm -rf "$ROOT"

echo "== generator: a CRLF target with matching facts is IN SYNC (no spurious drift) =="
# Windows / git autocrlf can check a target out with CRLF line endings. The
# generator renders the marker block with LF, so a naive byte compare would flag
# a CRLF-but-otherwise-identical target as drifted on --check and rewrite (strip
# \r) on --write — failing a contributor's PR for line endings they did not
# introduce. The generator must normalize CRLF->LF on read so drift is driven by
# FACTS, not line endings. (Committed form is pinned to LF by .gitattributes.)
ROOT="$(make_fixture)"
run_gen "$ROOT" --write >/dev/null 2>&1
perl -0pi -e 's/\n/\r\n/g' "$ROOT/AGENTS.md"   # convert the whole target to CRLF
if run_gen "$ROOT" --check >/dev/null 2>&1; then ok "CRLF target with matching facts → --check exits 0"; else bad "CRLF line endings must NOT read as drift"; fi
# And a CRLF target whose FACTS actually drifted must STILL be caught (the
# normalization must not mask real drift).
perl -0pi -e 's/01TESTPROJECTID0000000000/01TAMPERED0000000000000000/' "$ROOT/AGENTS.md"
if run_gen "$ROOT" --check >/dev/null 2>&1; then bad "CRLF must not mask a real fact drift"; else ok "CRLF target with drifted facts → --check exits non-zero"; fi
rm -rf "$ROOT"

echo "== generator: a bad/missing mode is a usage error (exit 2, not 0/1) =="
# `--check`/`--write` are the only modes. No arg or an unknown arg must exit 2
# (usage error) — distinct from 0 (in sync) and 1 (drift/misconfig), so a typo'd
# CI invocation fails loudly instead of being mistaken for a clean run.
ROOT="$(make_fixture)"
AGENTIC_SYNC_ROOT="$ROOT" node "$GEN" >/dev/null 2>&1; rc=$?
if [ "$rc" -eq 2 ]; then ok "no mode arg → exit 2"; else bad "no mode arg should exit 2, got $rc"; fi
AGENTIC_SYNC_ROOT="$ROOT" node "$GEN" --bogus >/dev/null 2>&1; rc=$?
if [ "$rc" -eq 2 ]; then ok "unknown mode arg → exit 2"; else bad "unknown mode arg should exit 2, got $rc"; fi
rm -rf "$ROOT"

echo "== wrapper: in-sync exits 0, drift exits 1 with remediation =="
ROOT="$(make_fixture)"
run_gen "$ROOT" --write >/dev/null 2>&1
if AGENTIC_SYNC_ROOT="$ROOT" bash "$WRAPPER" >/dev/null 2>&1; then ok "wrapper exits 0 when in sync"; else bad "wrapper should pass when in sync"; fi
perl -0pi -e 's/01TESTPROJECTID0000000000/01TAMPERED0000000000000000/' "$ROOT/AGENTS.md"
wrap_out="$(AGENTIC_SYNC_ROOT="$ROOT" bash "$WRAPPER" 2>&1)"; wrap_rc=$?
if [ "$wrap_rc" -ne 0 ]; then ok "wrapper exits non-zero on drift"; else bad "wrapper should fail on drift"; fi
if echo "$wrap_out" | grep -q -- "--write"; then ok "wrapper prints --write remediation"; else bad "wrapper missing remediation hint"; fi
rm -rf "$ROOT"

echo "== wrapper: leaves no mutation behind (it is a check, not a fix) =="
ROOT="$(make_fixture)"
run_gen "$ROOT" --write >/dev/null 2>&1
perl -0pi -e 's/01TESTPROJECTID0000000000/01TAMPERED0000000000000000/' "$ROOT/AGENTS.md"
before="$(shasum "$ROOT/AGENTS.md" | awk '{print $1}')"
AGENTIC_SYNC_ROOT="$ROOT" bash "$WRAPPER" >/dev/null 2>&1
after="$(shasum "$ROOT/AGENTS.md" | awk '{print $1}')"
if [ "$before" = "$after" ]; then ok "wrapper did not mutate the drifted file"; else bad "wrapper mutated a file in --check"; fi
rm -rf "$ROOT"

echo "== wrapper: under CI, an injected AGENTIC_SYNC_NODE is ignored (forces real node) =="
# Security invariant: in CI the wrapper pins NODE_BIN=node so an attacker-injected
# AGENTIC_SYNC_NODE env var cannot redirect the gate to a rogue binary. With the
# guard, a bogus AGENTIC_SYNC_NODE is ignored and the in-sync fixture still passes
# (exit 0). Without the guard, NODE_BIN would be the bogus path and the wrapper
# would die at the `command -v` check (exit 1) — so this case is load-bearing.
ROOT="$(make_fixture)"
run_gen "$ROOT" --write >/dev/null 2>&1
if CI=true AGENTIC_SYNC_NODE=/nonexistent/rogue-node AGENTIC_SYNC_ROOT="$ROOT" bash "$WRAPPER" >/dev/null 2>&1; then
  ok "CI=true ignores AGENTIC_SYNC_NODE and uses real node (exit 0)"
else
  bad "CI=true must ignore AGENTIC_SYNC_NODE — bogus override leaked through"
fi
rm -rf "$ROOT"

echo "== structural: gate is wired into required CI (anti-unwiring) =="
if grep -q "check-agentic-sync.sh" "$CI_YML"; then ok "ci.yml runs check-agentic-sync.sh"; else bad "ci.yml does not run the gate"; fi
if grep -q "agentic-sync" "$CI_YML"; then ok "ci.yml defines an agentic-sync job"; else bad "ci.yml missing agentic-sync job"; fi
# It must ride the required ci-success aggregate, not be a standalone advisory.
if awk '/^  ci-success:/{f=1} f&&/agentic-sync/{found=1} END{exit !found}' "$CI_YML"; then
  ok "agentic-sync is in the ci-success needs list"
else
  bad "agentic-sync not wired into ci-success"
fi
# The job's own `if:` must gate on the SAME ci-gate output the anti-tamper maps
# it to (needs-agentic). A grep for just the job name would pass even if the
# trigger were silently changed to a never-true output, so assert the wiring.
if grep -Eq "needs\.ci-gate\.outputs\.needs-agentic == 'true'" "$CI_YML"; then
  ok "agentic-sync job is gated on needs-agentic (trigger wired)"
else
  bad "agentic-sync job is not gated on needs-agentic"
fi
# Anti-tamper: the ci-success verifier must map THIS job to THIS trigger, not
# merely mention the string somewhere. Assert the exact check_triggered call so a
# dropped/renamed trigger arm fails the suite (mirrors the onboarding-guard test).
if grep -Eq 'check_triggered[[:space:]]+"agentic-sync"[[:space:]]+"needs-agentic"' "$CI_SUCCESS"; then
  ok "check-ci-success.sh maps agentic-sync → needs-agentic (exact anti-tamper wiring)"
else
  bad "check-ci-success.sh does not map agentic-sync to needs-agentic"
fi

# =============================================================================
echo ""
echo "  PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ] || { echo "SUITE FAILED"; exit 1; }
echo "SUITE PASSED"
