#!/usr/bin/env bash
# check-native-bindings.sh — assert the platform-native @next/swc binding
# survived npm ci (PF-947 / #8920).
#
# npm has a long-standing optional-dependency bug class (npm/cli#4828): an
# install can exit 0 while silently dropping the platform-specific optional
# package (@next/swc-<platform>-<arch>[-libc]). The failure then surfaces
# minutes later as an opaque `next build` error ("Failed to load SWC binary"),
# far from its cause. This gate runs immediately after `npm ci` in every job
# that builds Next.js and turns the silent drop into a loud, named failure at
# the install step.
#
# Usage: check-native-bindings.sh [node_modules_dir]
#   node_modules_dir defaults to <repo root>/node_modules (single-root
#   lockfile monorepo — web/ has no node_modules of its own).
#
# Exit codes:
#   0 — the platform-native binding is present with its .node binary
#   1 — the binding is missing or incomplete (the npm/cli#4828 drop)
#   2 — tooling/order error (no node, node_modules missing, next not in tree):
#       the gate refuses to pass vacuously when pointed at the wrong tree or
#       run before the install.
#
# TEST-ONLY SEAMS: NATIVE_BINDINGS_PLATFORM / NATIVE_BINDINGS_ARCH override the
# host platform/arch detection so scripts/__tests__/check-native-bindings.test.sh
# can exercise other platforms' package naming (the -gnu/-musl libc suffix on
# linux) hermetically from any dev machine. They are NEVER set in CI — the test
# suite asserts no workflow references them. SECURITY: the values are only used
# in filesystem path construction and [ -d ] tests, never eval'd or executed.

set -uo pipefail

if ! command -v node >/dev/null 2>&1; then
  echo "::error::check-native-bindings: node is not on PATH — cannot determine platform/arch." >&2
  exit 2
fi

ROOT="$(git rev-parse --show-toplevel 2>/dev/null)" || ROOT="$(pwd)"
NM_DIR="${1:-${ROOT}/node_modules}"

if [ ! -d "${NM_DIR}" ]; then
  echo "::error::check-native-bindings: ${NM_DIR} does not exist — run this gate AFTER npm ci." >&2
  exit 2
fi

# The gate is wired into next-build jobs; a tree without next at all means the
# path is mis-pointed, not that the binding check passed. Refuse, fail closed.
if [ ! -d "${NM_DIR}/next" ]; then
  echo "::error::check-native-bindings: ${NM_DIR}/next is missing — mis-pointed node_modules dir refused (this gate asserts the swc binding for a tree that installs next)." >&2
  exit 2
fi

PLATFORM="${NATIVE_BINDINGS_PLATFORM:-$(node -p process.platform)}"
ARCH="${NATIVE_BINDINGS_ARCH:-$(node -p process.arch)}"

# Binding package names: @next/swc-darwin-arm64 (bare) or
# @next/swc-linux-x64-gnu / -musl (hyphen-separated libc suffix). Accept the
# exact name or a `-<suffix>` — NOT a bare prefix glob, which would let arch
# 'arm' incorrectly match an 'arm64' package.
BASE="${NM_DIR}/@next/swc-${PLATFORM}-${ARCH}"
candidates=()
[ -d "${BASE}" ] && candidates+=("${BASE}")
shopt -s nullglob
for d in "${BASE}"-*; do
  [ -d "${d}" ] && candidates+=("${d}")
done
shopt -u nullglob

if [ "${#candidates[@]}" -eq 0 ]; then
  echo "::error::check-native-bindings: no @next/swc-${PLATFORM}-${ARCH}[-libc] package under ${NM_DIR}/@next — npm silently dropped the platform-native optional dependency (npm/cli#4828 class). Fix: clear the npm cache (npm cache clean --force) and re-run npm ci. Without this gate the drop would surface later as an opaque 'Failed to load SWC binary' next-build error." >&2
  exit 1
fi

for dir in "${candidates[@]}"; do
  for f in "${dir}"/*.node; do
    if [ -e "${f}" ]; then
      echo "check-native-bindings: OK — $(basename "${dir}") present with $(basename "${f}")."
      exit 0
    fi
  done
done

echo "::error::check-native-bindings: @next/swc-${PLATFORM}-${ARCH}[-libc] package dir exists but contains no .node binary — the install is incomplete. Fix: clear the npm cache (npm cache clean --force) and re-run npm ci." >&2
exit 1
