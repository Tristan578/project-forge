#!/usr/bin/env bash
# Emit the cache key that identifies a built engine WASM binary set.
#
# A positional mode selects the set: `webgl2` (default) for the single WebGL2
# editor binary, or `all4` for all four build-wasm variants. Both hash the same
# tree inputs and differ only by prefix — see "WHICH BINARY SET" near the bottom.
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
#
# `git rev-parse HEAD:<path>` yields the TREE hash, which changes if and only if
# the contents of that directory change — the property that makes this safe.
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
  # rev-parse prints a 40-char object id. Anything else means we resolved
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
#
# The content hash is IDENTICAL for both modes: all four variants are built from
# the same engine/ tree, the same .transform-gizmo-fork/ path dependency, and
# the same wasm-bindgen version — they differ only by cargo feature flags, which
# live in the workflow, not the tree. Only the prefix distinguishes the two
# cache entries, and it MUST distinguish them: actions/cache segments an entry
# by (key, hash(paths)), so the webgl2 entry (one path) and the all4 entry (four
# paths) are already different versions of the same key and could otherwise
# collide semantically — the prefix keeps the two intents legible and the
# anti-drift suite honest.
MODE="${1:-webgl2}"
case "$MODE" in
  webgl2) PREFIX='engine-wasm-webgl2' ;;
  all4)   PREFIX='engine-wasm-all4' ;;
  *)
    echo "::error::engine-wasm-cache-key: unknown mode '${MODE}' (expected 'webgl2' or 'all4')" >&2
    exit 1
    ;;
esac

ENGINE_TREE="$(resolve_tree engine)"
FORK_TREE="$(resolve_tree .transform-gizmo-fork)"

printf '%s-%s-%s-wb%s\n' "$PREFIX" "$ENGINE_TREE" "$FORK_TREE" "$WASM_BINDGEN_VERSION"
