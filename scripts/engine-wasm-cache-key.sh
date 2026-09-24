#!/usr/bin/env bash
# Emit the cache key that identifies a built engine WASM binary set.
#
# A positional mode selects the set: `webgl2` (default) for the single WebGL2
# editor binary, `all4` for all four build-wasm variants, or `ci-reuse` for the
# four variants a PR's CI run built for CD to adopt. All hash the same engine
# inputs; all4 adds the CD workflow recipe, and ci-reuse adds the PR-side recipe
# and bindgen installer on top of that — see "WHICH BINARY SET" near the bottom.
#
# WHY THIS IS A SCRIPT AND NOT TWO INLINE `run:` BLOCKS
#
# Two workflows have to agree on this key exactly: cd.yml SAVES the entry after
# building on main, and ci.yml's engine-smoke job RESTORES it. If those two
# expressions ever drift by a character, nothing breaks loudly — every restore
# simply misses, engine-smoke silently goes back to a 5-minute cargo build, and
# the only symptom is a slow job nobody is watching. One definition, used by
# both, with a suite pinning it (scripts/__tests__/engine-wasm-cache-key.test.sh).
#
# WHAT GOES INTO THE KEY
#
# Everything that determines the binary, so that a key collision cannot serve a
# WASM build that does not match the tree being tested:
#
#   engine/                  the engine source tree
#   .transform-gizmo-fork/   a PATH DEPENDENCY of the engine (engine/Cargo.toml
#                            points at ../.transform-gizmo-fork/crates/...), so
#                            it compiles into the binary — the same input that
#                            ci-gate used to miss entirely (#9567)
#   wasm-bindgen version     the bindgen output shape is version-specific
#   cd.yml (all4, ci-reuse)  the build recipe, including features/toolchain/flags
#   quality-gates.yml and    (ci-reuse only) the recipe and bindgen installer
#   install-wasm-bindgen-    that produced a PR's bytes, which CD adopts
#   cli.sh
#
# `git rev-parse HEAD:<path>` yields a tree hash for source directories or a
# blob hash for the workflow, changing when that committed input changes.
# It is not the commit SHA: an unrelated commit that touches nothing under these
# paths keeps the same key, which is exactly the reuse being bought.
#
# FAIL LOUDLY, NOT QUIETLY. If a path cannot be resolved this exits non-zero
# rather than emitting a degenerate key. A key that never matches would disable
# the optimisation permanently and invisibly; a failed step is seen and fixed.
set -euo pipefail

# The pinned wasm-bindgen version. Must match the `cargo install
# wasm-bindgen-cli --version` in ci.yml, cd.yml and quality-gates.yml, and the
# wasm-bindgen entry in engine/Cargo.lock (CLAUDE.md pins these together).
WASM_BINDGEN_VERSION="${WASM_BINDGEN_VERSION:-0.2.127}"

# TEST SEAM: the ref to resolve trees against. Defaults to HEAD; the suite
# points it at fixture commits.
REF="${ENGINE_CACHE_KEY_REF:-HEAD}"

resolve_tree() {
  local path="$1" tree
  if ! tree="$(git rev-parse "${REF}:${path}" 2>/dev/null)"; then
    echo "::error::engine-wasm-cache-key: cannot resolve '${REF}:${path}'. That path is a build input; if it moved, update this script rather than dropping it from the key." >&2
    exit 1
  fi
  # rev-parse prints a 40-char tree or blob object id. Anything else means we resolved
  # something we did not expect, and a malformed key must not reach a cache.
  if [[ ! "$tree" =~ ^[0-9a-f]{40}$ ]]; then
    echo "::error::engine-wasm-cache-key: '${REF}:${path}' resolved to '${tree}', not an object id" >&2
    exit 1
  fi
  printf '%s' "$tree"
}

# WHICH BINARY SET DOES THIS KEY IDENTIFY? (positional arg, default 'webgl2')
#
#   webgl2 (default)  the single WebGL2 editor binary. ci.yml's engine-smoke
#                     RESTORES this and cd.yml's publish-engine-cache WARMS it,
#                     both listing exactly `engine/pkg-webgl2`. Left as the
#                     default so those two callers keep working untouched.
#   all4              all four variants cd.yml's build-wasm produces: pkg-webgl2,
#                     pkg-webgpu, pkg-webgl2-runtime, pkg-webgpu-runtime.
#   ci-reuse          the same four variants as BUILT BY quality-gates.yml on a
#                     pull request, before its wasm-opt step, which cd.yml's
#                     build-wasm may adopt on the first CD run after that PR
#                     merges instead of rebuilding (#9525). Not a cache key: it
#                     is written into the PR's `wasm-binaries-cd-reuse` artifact
#                     and compared, byte for byte, with the value recomputed on
#                     main by scripts/resolve-ci-wasm-artifact.sh adopt.
#
# All modes share engine/fork/bindgen inputs and have distinct prefixes. The
# all4 set also hashes the complete CD workflow blob: changing cargo features,
# toolchain selection or bindgen arguments must invalidate immutable binaries.
# Hashing the whole workflow is conservative (unrelated CD edits also miss) but
# avoids a brittle extraction of only selected build steps. The legacy webgl2
# key stays byte-for-byte compatible with CI and the existing main warmer.
#
# ci-reuse is all4 plus the two inputs that differ on the PR side: the
# quality-gates.yml blob (the recipe that actually built the bytes) and
# scripts/install-wasm-bindgen-cli.sh (how that runner got wasm-bindgen). It
# extends all4 rather than redefining it, because an adopted set is persisted
# under the all4 key afterwards. The PR builds on refs/pull/N/merge, so if
# another change to any of these inputs lands between that CI run and the merge,
# the two sides compute different keys and CD builds. That is the whole safety
# argument, and it is why the comparison is exact.
#
# The rustc version is deliberately NOT in any mode. Every workflow installs the
# floating `stable` channel, so it cannot be known without installing it, and
# the all4 and webgl2 entries already reuse across it for up to seven days.
MODE="${1:-webgl2}"
case "$MODE" in
  webgl2)   PREFIX='engine-wasm-webgl2' ;;
  all4)     PREFIX='engine-wasm-all4' ;;
  ci-reuse) PREFIX='engine-wasm-ci-reuse' ;;
  *)
    echo "::error::engine-wasm-cache-key: unknown mode '${MODE}' (expected 'webgl2', 'all4' or 'ci-reuse')" >&2
    exit 1
    ;;
esac

ENGINE_TREE="$(resolve_tree engine)"
FORK_TREE="$(resolve_tree .transform-gizmo-fork)"

case "$MODE" in
  all4)
    RECIPE_BLOB="$(resolve_tree .github/workflows/cd.yml)"
    printf '%s-%s-%s-wb%s-recipe%s\n' "$PREFIX" "$ENGINE_TREE" "$FORK_TREE" "$WASM_BINDGEN_VERSION" "$RECIPE_BLOB"
    ;;
  ci-reuse)
    RECIPE_BLOB="$(resolve_tree .github/workflows/cd.yml)"
    QG_BLOB="$(resolve_tree .github/workflows/quality-gates.yml)"
    INSTALLER_BLOB="$(resolve_tree scripts/install-wasm-bindgen-cli.sh)"
    printf '%s-%s-%s-wb%s-recipe%s-qg%s-bgi%s\n' "$PREFIX" "$ENGINE_TREE" "$FORK_TREE" "$WASM_BINDGEN_VERSION" "$RECIPE_BLOB" "$QG_BLOB" "$INSTALLER_BLOB"
    ;;
  *)
    printf '%s-%s-%s-wb%s\n' "$PREFIX" "$ENGINE_TREE" "$FORK_TREE" "$WASM_BINDGEN_VERSION"
    ;;
esac
