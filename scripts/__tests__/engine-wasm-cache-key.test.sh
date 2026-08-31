#!/usr/bin/env bash
# Contract test for scripts/engine-wasm-cache-key.sh — the key that lets
# engine-smoke reuse a WebGL2 binary instead of spending 321s rebuilding one.
#
# WHY THIS SUITE EXISTS
#
# Two failure modes, and neither one is loud:
#
#   1. THE KEY IS TOO NARROW. If an input that changes the binary is missing
#      from the key, two different engine trees collide on one entry and
#      engine-smoke tests a WASM build that does not match the source under
#      test. A green gate over the wrong binary is worse than no gate.
#      `.transform-gizmo-fork` is the live example: it is a PATH DEPENDENCY
#      compiled into the engine, and ci-gate omitted it from its filters
#      entirely until #9567.
#
#   2. THE KEY IS TOO WIDE, OR THE TWO CALLERS DRIFT. cd.yml saves the entry
#      and ci.yml restores it. If the key varies on something irrelevant (a
#      commit SHA rather than a tree hash), or the two workflows compute it
#      differently, every restore misses — engine-smoke quietly returns to a
#      five-minute build and the only symptom is a slow job. Nothing fails.
#
# So the cases below pin BOTH directions: what must change the key, what must
# NOT, and that both workflows go through this one script rather than
# reimplementing it inline.
#
# Assertions use explicit if/then/else (NOT `A && ok || bad`) so this suite has
# no SC2015 findings — CI's self-defense job shellchecks it.
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SCRIPT="$HERE/../engine-wasm-cache-key.sh"
REPO_ROOT="$(cd "$HERE/../.." && pwd)"
CI_YML="$REPO_ROOT/.github/workflows/ci.yml"
CD_YML="$REPO_ROOT/.github/workflows/cd.yml"

PASS=0
FAIL=0
pass() { echo "  PASS: $1"; PASS=$((PASS + 1)); }
fail() { echo "  FAIL: $1"; FAIL=$((FAIL + 1)); }

[ -f "$SCRIPT" ] || { echo "key script not found: $SCRIPT"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "git not found — required to run these tests"; exit 1; }

echo "=== engine-wasm-cache-key.sh ==="

# A throwaway repo carrying the two paths the key is built from. Commits are
# real commits so `git rev-parse HEAD:<path>` resolves actual tree objects —
# the property under test.
make_repo() {
  local repo
  repo="$(mktemp -d)"
  (
    cd "$repo" || exit 1
    git init -q
    git config user.email t@t.t
    git config user.name t
    mkdir -p engine/src .transform-gizmo-fork/crates
    printf 'fn main() {}\n' > engine/src/lib.rs
    printf '[package]\nname = "forge_engine"\n' > engine/Cargo.toml
    printf 'gizmo source\n' > .transform-gizmo-fork/crates/lib.rs
    printf 'unrelated\n' > README.md
    git add -A
    git commit -qm base
  )
  printf '%s' "$repo"
}

key_in() { ( cd "$1" && bash "$SCRIPT" 2>/dev/null ); }

commit_in() {
  ( cd "$1" && git add -A && git commit -qm "$2" )
}

REPO="$(make_repo)"
BASE_KEY="$(key_in "$REPO")"

# --- 1. Shape -----------------------------------------------------------------
if [[ "$BASE_KEY" =~ ^engine-wasm-webgl2-[0-9a-f]{40}-[0-9a-f]{40}-wb[0-9.]+$ ]]; then
  pass "key has the expected shape (two tree hashes + a pinned bindgen version)"
else
  fail "unexpected key shape: '$BASE_KEY'"
fi

# --- 2. Deterministic ---------------------------------------------------------
if [ "$(key_in "$REPO")" = "$BASE_KEY" ]; then
  pass "the same tree yields the same key"
else
  fail "key is not deterministic for an unchanged tree"
fi

# --- 3. An unrelated commit must NOT change the key ----------------------------
# This is the whole point: a web-only PR keeps main's key and reuses its binary.
# If this fails the cache never hits and the optimisation silently evaporates.
printf 'unrelated edit\n' >> "$REPO/README.md"
commit_in "$REPO" "touch an unrelated file"
if [ "$(key_in "$REPO")" = "$BASE_KEY" ]; then
  pass "a commit touching neither input leaves the key unchanged (this is the reuse)"
else
  fail "an unrelated commit changed the key — every web-only PR would miss the cache"
fi

# --- 4. An engine change MUST change the key ----------------------------------
printf 'fn added() {}\n' >> "$REPO/engine/src/lib.rs"
commit_in "$REPO" "change engine source"
ENGINE_KEY="$(key_in "$REPO")"
if [ "$ENGINE_KEY" != "$BASE_KEY" ]; then
  pass "an engine/ change changes the key"
else
  fail "an engine/ change did NOT change the key — engine-smoke would test a stale binary"
fi

# --- 5. A path-dependency change MUST change the key --------------------------
# .transform-gizmo-fork compiles INTO the binary (engine/Cargo.toml path dep).
# Omitting it is exactly the class of miss #9567 fixed in ci-gate.
printf 'gizmo edit\n' >> "$REPO/.transform-gizmo-fork/crates/lib.rs"
commit_in "$REPO" "change the path dependency"
if [ "$(key_in "$REPO")" != "$ENGINE_KEY" ]; then
  pass ".transform-gizmo-fork/ is in the key (it is a path dependency, not vendored ballast)"
else
  fail ".transform-gizmo-fork/ change did NOT change the key — a fork edit would reuse a binary built without it"
fi

# --- 6. The pinned bindgen version participates -------------------------------
CUR="$(key_in "$REPO")"
BUMPED="$( ( cd "$REPO" && WASM_BINDGEN_VERSION=9.9.9 bash "$SCRIPT" 2>/dev/null ) )"
if [ "$BUMPED" != "$CUR" ]; then
  pass "the wasm-bindgen version participates in the key"
else
  fail "changing the bindgen version left the key identical"
fi

# --- 7. Fail loudly on a missing input ----------------------------------------
# A degenerate key would disable reuse permanently and invisibly. A non-zero
# exit is seen and fixed.
rm -rf "$REPO/.transform-gizmo-fork"
commit_in "$REPO" "remove the path dependency"
OUT="$( ( cd "$REPO" && bash "$SCRIPT" 2>&1 ) )" && RC=0 || RC=$?
if [ "$RC" -ne 0 ]; then
  pass "an unresolvable input exits non-zero rather than emitting a degenerate key (exit $RC)"
else
  fail "a missing build input still produced a key: '$OUT'"
fi
if grep -q "cannot resolve" <<<"$OUT"; then
  pass "the failure names the path it could not resolve"
else
  fail "expected a 'cannot resolve' message, got: $OUT"
fi
rm -rf "$REPO"

# --- 8. ANTI-DRIFT: both workflows must go through this script -----------------
# The save side (cd.yml) and the restore side (ci.yml) only ever agree because
# they call the same script. An inline reimplementation in either one is the
# silent-miss failure mode this suite exists to prevent.
echo ""
echo "=== both callers use the shared script (anti-drift) ==="
for spec in "ci.yml:$CI_YML" "cd.yml:$CD_YML"; do
  name="${spec%%:*}"
  path="${spec#*:}"
  if [ ! -f "$path" ]; then
    fail "$name not found at $path"
    continue
  fi
  if grep -q 'scripts/engine-wasm-cache-key\.sh' "$path"; then
    pass "$name derives the cache key from scripts/engine-wasm-cache-key.sh"
  else
    fail "$name does not call scripts/engine-wasm-cache-key.sh — the two sides can drift and every restore would miss"
  fi
  # An inline `rev-parse HEAD:engine` next to the script call would mean someone
  # started recomputing the key by hand.
  if grep -qE 'rev-parse[^|]*HEAD:engine' "$path"; then
    fail "$name computes an engine tree hash inline; that is what the shared script is for"
  else
    pass "$name does not recompute the key inline"
  fi
done

# The cache is only useful if SOMETHING on main keeps it warm. cd.yml's
# build-wasm job is gated on engine-changed and measured as running once in the
# last twelve CD runs, so a save that lives only there leaves the entry absent
# on the other eleven -- every PR restoring nothing and rebuilding for no
# benefit, with the feature looking installed and doing nothing. Pin that an
# ungated warmer exists.
echo ""
echo "=== main keeps the cache warm (not just on engine-change merges) ==="
warmer="$(awk '/^  publish-engine-cache:/{f=1} f && /^  [a-z][a-z0-9-]*:$/ && !/^  publish-engine-cache:/{exit} f' "$CD_YML")"
if [ -z "$warmer" ]; then
  fail "cd.yml has no publish-engine-cache job — the cache would only be seeded when an engine change merges"
else
  pass "cd.yml defines publish-engine-cache"
  if grep -qE '^    if:' <<<"$warmer"; then
    fail "publish-engine-cache carries a job-level if: — gating the warmer reintroduces the cold-cache hole it exists to close"
  else
    pass "publish-engine-cache is ungated (runs on every push to main)"
  fi
  if grep -q 'scripts/engine-wasm-cache-key.sh' <<<"$warmer"; then
    pass "publish-engine-cache derives its key from the shared script"
  else
    fail "publish-engine-cache does not use the shared key script — it could warm the wrong key"
  fi
fi

echo ""
echo "  PASS=$PASS FAIL=$FAIL"
if [ "$FAIL" -eq 0 ]; then
  echo "SUITE PASSED"
  exit 0
fi
echo "SUITE FAILED"
exit 1
