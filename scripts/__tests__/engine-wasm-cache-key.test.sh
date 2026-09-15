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
# benefit, with the feature looking installed and doing nothing.
#
# What matters is COVERAGE, not the absence of a gate. This assertion used to
# demand the warmer carry no if: at all, which was a blunt proxy for coverage
# and turned out to forbid the correct design: ungated, the warmer and
# build-wasm both miss the same cold key on an engine-change push and build the
# engine CONCURRENTLY, paying for the expensive build twice. The warmer is now
# the exact complement of build-wasm, so between them every main push is
# covered and no push runs both. That is pinned here and in the
# mutual-exclusion block below; the two halves must be read together.
echo ""
echo "=== main keeps the cache warm (not just on engine-change merges) ==="
warmer="$(awk '/^  publish-engine-cache:/{f=1} f && /^  [a-z][a-z0-9-]*:$/ && !/^  publish-engine-cache:/{exit} f' "$CD_YML")"
if [ -z "$warmer" ]; then
  fail "cd.yml has no publish-engine-cache job — the cache would only be seeded when an engine change merges"
else
  pass "cd.yml defines publish-engine-cache"
  warmer_if="$(grep -E '^    if:' <<<"$warmer" || true)"
  if [ -z "$warmer_if" ]; then
    # Ungated is not "safe by default" here -- it is the duplicate-build bug.
    fail "publish-engine-cache carries no job-level if: — ungated it runs alongside build-wasm on engine-change pushes, both miss the same cold key, and the engine is built twice concurrently"
  else
    pass "publish-engine-cache is gated (its complement of build-wasm is verified below)"
  fi
  if grep -q 'scripts/engine-wasm-cache-key.sh' <<<"$warmer"; then
    pass "publish-engine-cache derives its key from the shared script"
  else
    fail "publish-engine-cache does not use the shared key script — it could warm the wrong key"
  fi
fi

# --- exactly one writer per run ------------------------------------------------
# Two jobs write this key: build-wasm (free -- it just built the artifact) and
# publish-engine-cache (the eviction safety net). They MUST be mutually
# exclusive. When both are live on the same run they miss the same cold key and
# build the engine CONCURRENTLY -- the expensive build paid twice, on exactly
# the pushes that are already the slowest, and no job goes red to say so.
echo ""
echo "=== the two cache writers must be mutually exclusive ==="
if [ ! -f "$CD_YML" ]; then
  fail "cd.yml not found at $CD_YML"
else
  bw_if="$(awk '/^  build-wasm:/{f=1} f && /^    if:/{print; exit}' "$CD_YML")"
  pc_if="$(awk '/^  publish-engine-cache:/{f=1} f && /^    if:/{print; exit}' "$CD_YML")"

  writers="$(grep -cE '^ +key: \$\{\{ steps\.engine-key\.outputs\.key \}\}' "$CD_YML" || true)"
  if [ "$writers" -eq 2 ]; then
    pass "cd.yml has exactly 2 jobs keyed on the engine cache key"
  else
    fail "cd.yml has $writers jobs keyed on steps.engine-key.outputs.key (expected 2) — if a third writer appeared, the mutual-exclusion argument below no longer covers every writer"
  fi

  if [ -z "$pc_if" ]; then
    fail "publish-engine-cache has no if: — it runs on EVERY push, including the engine-changed pushes where build-wasm is already building and saving the same key, so the engine gets built twice concurrently"
  elif grep -qE "engine-changed != 'true'[[:space:]]*&&[[:space:]]*github[.]event_name != 'workflow_dispatch'" <<<"$pc_if"; then
    pass "publish-engine-cache runs only when build-wasm does not (operator pinned: != AND !=)"
  else
    fail "publish-engine-cache's if: is not the complement of build-wasm's — got: ${pc_if}"
  fi

  # Pin the other half too: if build-wasm's trigger is ever widened, the
  # complement above silently stops being a complement.
  # The OPERATOR is pinned, not just the two operands. Grepping for each clause
  # separately passes whether they are joined by || or &&, and swapping them
  # inverts the complement below so that on an engine change NEITHER job runs
  # and nothing builds or caches the engine at all.
  if grep -qE "engine-changed == 'true'[[:space:]]*\|\|[[:space:]]*github[.]event_name == 'workflow_dispatch'" <<<"$bw_if"; then
    pass "build-wasm triggers on engine-changed OR workflow_dispatch (operator pinned)"
  else
    fail "build-wasm's trigger is not 'engine-changed == true || workflow_dispatch' — got: ${bw_if} — publish-engine-cache's complement must be updated in the same commit or the two stop being complements"
  fi
fi

# --- the rebuild trigger must cover every input the key does -------------------
# These two must not disagree. The key is content-addressed over engine/ AND
# .transform-gizmo-fork/ (a path dependency that compiles into the binary), but
# cd.yml decides whether to REBUILD from its own path filter. When the filter is
# narrower than the key, a change to the uncovered path produces a new key --
# so CI rebuilds and tests a fresh binary -- while build-wasm skips and the CDN
# keeps serving the old one. Tests pass on a binary users never receive, which
# is worse than either half failing on its own.
echo ""
echo "=== cd.yml rebuilds for every path the cache key is derived from ==="
if [ ! -f "$CD_YML" ]; then
  fail "cd.yml not found at $CD_YML"
else
  # The line that decides engine=true. Matched on its two stable parts rather
  # than on the exact regex, which is what this rule is allowed to change.
  engine_filter="$(grep -E "grep -q" "$CD_YML" | grep -F "engine/" || true)"
  if [ -z "$engine_filter" ]; then
    fail "could not find the engine path filter in cd.yml — this rule would pass vacuously"
  else
    for path_input in 'engine/' 'transform-gizmo-fork/'; do
      if grep -qF "$path_input" <<<"$engine_filter"; then
        pass "cd.yml's engine filter covers '${path_input}' (a cache-key input)"
      else
        fail "cd.yml's engine filter does not cover '${path_input}', which engine-wasm-cache-key.sh includes in the key — a change there gives a new key (CI rebuilds) while build-wasm skips (production keeps the stale engine)"
      fi
    done
  fi
fi

# --- all4 mode: the four-variant key (#9525) ----------------------------------
# cd.yml's build-wasm reuses a content-addressed cache covering all FOUR engine
# variants, not just the WebGL2 editor binary. The four are built from the SAME
# engine tree + fork + bindgen version and differ only by cargo feature flags,
# so the key's hash body is identical to the webgl2 key's and only the prefix
# distinguishes them. The prefix MUST distinguish them: actions/cache segments a
# cache by (key, hash(paths)), so a four-path save and the single-path restore
# engine-smoke does would otherwise be two versions of one key and the restore
# would silently miss.
echo ""
echo "=== all4 mode identifies the four-variant set with the same tree hash ==="
REPO4="$(make_repo)"
key4_in() { ( cd "$1" && bash "$SCRIPT" all4 2>/dev/null ); }
ALL4_KEY="$(key4_in "$REPO4")"
WEBGL2_KEY="$(key_in "$REPO4")"

if [[ "$ALL4_KEY" =~ ^engine-wasm-all4-[0-9a-f]{40}-[0-9a-f]{40}-wb[0-9.]+$ ]]; then
  pass "all4 key has the expected shape (distinct prefix + two tree hashes + bindgen version)"
else
  fail "unexpected all4 key shape: '$ALL4_KEY'"
fi

if [ "${ALL4_KEY#engine-wasm-all4-}" = "${WEBGL2_KEY#engine-wasm-webgl2-}" ]; then
  pass "all4 and webgl2 keys share the identical tree-hash body (they differ only by prefix)"
else
  fail "all4 body '${ALL4_KEY#engine-wasm-all4-}' != webgl2 body '${WEBGL2_KEY#engine-wasm-webgl2-}' — the two entries stopped describing the same source"
fi

if [ "$ALL4_KEY" != "$WEBGL2_KEY" ]; then
  pass "all4 and webgl2 keys are distinct (the four-path entry cannot collide with the single-path webgl2 entry)"
else
  fail "all4 and webgl2 produced the same key — a four-path save would make engine-smoke's single-path restore silently miss"
fi

printf 'unrelated all4 edit\n' >> "$REPO4/README.md"
commit_in "$REPO4" "unrelated edit"
if [ "$(key4_in "$REPO4")" = "$ALL4_KEY" ]; then
  pass "an unrelated commit leaves the all4 key unchanged (reuse holds for the four-variant set)"
else
  fail "an unrelated commit changed the all4 key — every reuse would miss"
fi

printf 'fn added() {}\n' >> "$REPO4/engine/src/lib.rs"
commit_in "$REPO4" "engine change"
if [ "$(key4_in "$REPO4")" != "$ALL4_KEY" ]; then
  pass "an engine/ change changes the all4 key (build-wasm rebuilds all four rather than reusing a stale set)"
else
  fail "an engine/ change did NOT change the all4 key — build-wasm would reuse a stale four-variant set"
fi
rm -rf "$REPO4"

# An unknown mode must fail loudly rather than emit a degenerate key — the case
# guard runs before any tree is resolved, so this holds in any directory.
if bash "$SCRIPT" bogus >/dev/null 2>&1; then
  fail "an unknown mode still produced a key rather than exiting non-zero"
else
  pass "an unknown mode exits non-zero rather than emitting a degenerate key"
fi

# --- build-wasm reuses the content-addressed cache for ALL FOUR variants -------
# The ticket replaces build-wasm's broken same-SHA `download-artifact` reuse
# (no run-id/github-token, `continue-on-error` masking every failure) with a
# content-addressed cache covering all four variants, and adds a completeness
# gate so a partial restored/built set cannot reach the CDN.
echo ""
echo "=== cd.yml build-wasm reuses the content-addressed cache for all 4 variants (#9525) ==="
if [ ! -f "$CD_YML" ]; then
  fail "cd.yml not found at $CD_YML"
else
  buildwasm="$(awk '/^  build-wasm:/{f=1} f && /^  [a-z][a-z0-9-]*:$/ && !/^  build-wasm:/{exit} f' "$CD_YML")"
  if [ -z "$buildwasm" ]; then
    fail "could not extract the build-wasm job from cd.yml"
  else
    # 1. The four-variant key comes from the shared script's all4 mode — not an
    #    inline reimplementation, and not the webgl2-only default.
    if grep -qE 'engine-wasm-cache-key\.sh[[:space:]]+all4' <<<"$buildwasm"; then
      pass "build-wasm derives the 4-variant key from scripts/engine-wasm-cache-key.sh all4"
    else
      fail "build-wasm does not call 'engine-wasm-cache-key.sh all4' — the four-variant reuse would drift from the shared key or fall back to webgl2 only"
    fi

    # 2. The cache entry (restore AND save) lists all four variant directories.
    #    Anchored to a BARE path line so pkg-webgl2 is not conflated with
    #    pkg-webgl2-runtime, nor with the inline `path: engine/pkg-webgl2` of the
    #    separate single-path webgl2 save, nor with the trailing-slash upload
    #    paths.
    for v in pkg-webgl2 pkg-webgpu pkg-webgl2-runtime pkg-webgpu-runtime; do
      n="$(grep -cE "^[[:space:]]+engine/${v}$" <<<"$buildwasm" || true)"
      if [ "$n" -ge 2 ]; then
        pass "build-wasm's all4 cache covers engine/${v} on $n bare path lines (restore + save)"
      else
        fail "build-wasm's all4 cache lists engine/${v} on only $n bare path line(s) (expected restore + save) — a variant absent from the entry is rebuilt every run or reused stale"
      fi
    done

    # 3. The completeness gate exists and asserts EXACTLY four variants.
    if grep -q 'Verify all 4 WASM variants' <<<"$buildwasm"; then
      pass "build-wasm has the 4-variant completeness assertion step"
    else
      fail "build-wasm has no '4 WASM variants' completeness step — a partial restored/built set could reach the CDN"
    fi
    if grep -qE '\-ne 4' <<<"$buildwasm"; then
      pass "the completeness step fails unless exactly 4 variants are verified"
    else
      fail "the completeness step does not assert a count of exactly 4"
    fi

    # 4. The broken same-SHA reuse step and its silent mask are gone.
    if grep -q 'Try downloading WASM from CI' <<<"$buildwasm"; then
      fail "build-wasm still contains the same-SHA 'download-artifact' reuse step this ticket replaces"
    else
      pass "build-wasm no longer contains the same-SHA download-artifact reuse step"
    fi
    # Anchored to a real YAML key (`^\s*continue-on-error:`) so the word inside
    # the explanatory comments above the restore step is not counted — a comment
    # describing the removed mask is not the mask.
    if grep -qE '^[[:space:]]*continue-on-error:' <<<"$buildwasm"; then
      fail "build-wasm still has a continue-on-error: step field — a reuse failure could be masked as success (the exact bug #9525 fixes)"
    else
      pass "build-wasm has no continue-on-error: step field (a reuse failure surfaces as a red step)"
    fi

    # 5. Every BUILD step is gated on a cache MISS. On a hit the four variants
    #    were restored, so installing a toolchain and rebuilding all four is pure
    #    waste; more importantly, if any of these `if:` guards is ever dropped
    #    (an edit near the block, a bad merge resolution) build-wasm silently
    #    reverts to ALWAYS rebuilding — the exact silent-reuse-breakage #9525
    #    exists to fix, and nothing would go red to say so. Each guarded step is
    #    checked by name (or by its `uses:` for the two unnamed action steps) so
    #    a dropped guard names the specific step that lost it.
    guard="if: steps.engine-cache-all4.outputs.cache-hit != 'true'"
    # Extract a single step's block (its opening `- ` line through the line
    # before the next `- ` step) and report whether it carries the guard:
    # 0 = guarded, 1 = present but unguarded, 2 = no such step.
    step_has_guard() {
      local ident="$1" block
      block="$(awk -v id="$ident" '
        /^      - / { instep = (index($0, id) > 0) }
        instep { print }
      ' <<<"$buildwasm")"
      if [ -z "$block" ]; then
        return 2
      fi
      if grep -qF "$guard" <<<"$block"; then
        return 0
      fi
      return 1
    }
    # label => identifying substring of the step's opening line. The three setup
    # steps (toolchain, cargo cache, wasm-bindgen-cli) plus the six cargo
    # build/bindgen steps are the nine that must never run on a hit.
    gated_steps=(
      "rust toolchain install|dtolnay/rust-toolchain"
      "cargo target cache|Swatinem/rust-cache"
      "wasm-bindgen-cli install|Install wasm-bindgen-cli"
      "build WebGL2 editor|Build WebGL2 + wasm-bindgen"
      "build WebGPU editor|Build WebGPU + wasm-bindgen"
      "build WebGL2 runtime|Build WebGL2 Runtime (stripped editor)"
      "bindgen WebGL2 runtime|Run wasm-bindgen (WebGL2 Runtime)"
      "build WebGPU runtime|Build WebGPU Runtime (stripped editor)"
      "bindgen WebGPU runtime|Run wasm-bindgen (WebGPU Runtime)"
    )
    for entry in "${gated_steps[@]}"; do
      label="${entry%%|*}"
      ident="${entry#*|}"
      step_has_guard "$ident"
      rc=$?
      if [ "$rc" -eq 0 ]; then
        pass "build-wasm's '$label' step is gated on a cache miss"
      elif [ "$rc" -eq 2 ]; then
        fail "build-wasm has no step matching '$ident' — the '$label' build step was renamed or removed, so its cache-miss gate is unverifiable"
      else
        fail "build-wasm's '$label' step lost its '$guard' guard — on a MISS a dropped guard is invisible, but a merge that drops it silently reverts build-wasm to rebuilding on every run (#9525)"
      fi
    done

    # The guard total pins the whole set at once: nine build steps above plus the
    # Persist save below = 10. A guard silently dropped from any one of them
    # takes this count off 10 even if a step was also renamed past the per-step
    # checks above, so this catches the drop the per-step loop would miss.
    guard_count="$(grep -cF "$guard" <<<"$buildwasm")"
    if [ "$guard_count" -eq 10 ]; then
      pass "build-wasm carries exactly 10 cache-miss guards (9 build steps + the Persist save)"
    else
      fail "build-wasm has $guard_count cache-miss guards (expected 10) — a guard was added or dropped; a dropped one silently reverts build-wasm to rebuilding on every run"
    fi

    # 6. The `Persist all 4 WASM variants` save step exists, is itself gated on a
    #    cache MISS (re-saving an existing key warns and no-ops, and on a hit the
    #    set came from this same cache), writes all four variant directories, and
    #    keys them on the SAME all4 key the restore reads. Without this step the
    #    four-variant set is never written from CD, so a later re-run/dispatch on
    #    the same engine tree rebuilds all four for no benefit — the reuse the
    #    ticket adds would look installed and do nothing.
    persist="$(awk '
      /^      - / { instep = (index($0, "Persist all 4 WASM variants") > 0) }
      instep { print }
    ' <<<"$buildwasm")"
    if [ -z "$persist" ]; then
      fail "build-wasm has no 'Persist all 4 WASM variants' step — the four-variant set is never written to the content-addressed cache from CD, so every later run rebuilds it"
    else
      pass "build-wasm has the 'Persist all 4 WASM variants' save step"
      if grep -qF "$guard" <<<"$persist"; then
        pass "the Persist step is gated on a cache miss (no redundant re-save on a hit)"
      else
        fail "the Persist step is not gated on '$guard' — on a hit it re-saves a key that already exists (warns/no-ops), and losing the gate here hides the reuse's write path"
      fi
      if grep -qE '^[[:space:]]*uses:[[:space:]]*actions/cache/save' <<<"$persist"; then
        pass "the Persist step uses actions/cache/save"
      else
        fail "the Persist step does not use actions/cache/save — it cannot write the four-variant entry"
      fi
      for v in pkg-webgl2 pkg-webgpu pkg-webgl2-runtime pkg-webgpu-runtime; do
        if grep -qE "^[[:space:]]+engine/${v}$" <<<"$persist"; then
          pass "the Persist step saves engine/${v}"
        else
          fail "the Persist step does not list engine/${v} — the four-variant entry it writes would be incomplete, and a later restore would serve a partial set"
        fi
      done
      if grep -qE 'key: \$\{\{ steps\.engine-key-all4\.outputs\.key \}\}' <<<"$persist"; then
        pass "the Persist step keys the save on steps.engine-key-all4.outputs.key (the same key the restore reads)"
      else
        fail "the Persist step does not key on steps.engine-key-all4.outputs.key — a save under any other key can never be restored, so the reuse never hits"
      fi
    fi
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
