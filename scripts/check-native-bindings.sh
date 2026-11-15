#!/usr/bin/env bash
# check-native-bindings.sh — assert every platform-native binding this repo
# depends on survived npm ci (PF-947 / #8920, generalised in #9966).
#
# npm has a long-standing optional-dependency bug class (npm/cli#4828): an
# install can exit 0 while silently dropping a platform-specific optional
# package. The failure then surfaces minutes later, far from its cause, as
# something opaque:
#
#   @next/swc-*         → `next build`: "Failed to load SWC binary"
#   @rolldown/binding-* → `vitest run`: "Cannot find native binding", and the
#                         suite emits NO output at all — not a failure summary,
#                         silence. A downstream check asking "did the suite
#                         report failures?" then concludes nothing (#9962).
#
# This gate runs immediately after `npm ci` and turns the silent drop into a
# loud, named failure at the install step.
#
# THE LIST IS THE POINT. This used to hardcode @next/swc. `@rolldown/binding-*`
# arrived with vitest 5 and became equally load-bearing with nothing checking
# it — the same gate, a new blind spot. Adding the next native dependency is now
# one line in NATIVE_BINDINGS below.
#
# Usage: check-native-bindings.sh [node_modules_dir]
#   node_modules_dir defaults to <repo root>/node_modules (single-root
#   lockfile monorepo — web/ has no node_modules of its own).
#
# Exit codes:
#   0 — every APPLICABLE binding is present with its .node binary
#   1 — an applicable binding is missing or incomplete (the npm/cli#4828 drop)
#   2 — tooling/order error (no node, node_modules missing, or NO declared
#       binding applies to this tree): the gate refuses to pass vacuously when
#       pointed at the wrong tree or run before the install.
#
# TEST-ONLY SEAMS: NATIVE_BINDINGS_PLATFORM / NATIVE_BINDINGS_ARCH override the
# host platform/arch detection so scripts/__tests__/check-native-bindings.test.sh
# can exercise other platforms' package naming (the -gnu/-musl/-msvc suffixes)
# hermetically from any dev machine. They are NEVER set in CI — the test
# suite asserts no workflow references them. SECURITY: the values are only used
# in filesystem path construction and [ -d ] tests, never eval'd or executed.

set -uo pipefail

# Declared native bindings: "<scope>/<prefix>|<sentinel>".
#
#   scope/prefix — packages are named <scope>/<prefix>-<platform>-<arch>, with
#                  an optional -<suffix> (libc on linux, msvc on windows).
#   sentinel     — the top-level package whose presence makes this entry apply.
#                  A tree that does not install the sentinel legitimately has no
#                  such binding, so the entry is skipped rather than failed. If
#                  NOTHING applies, the gate exits 2 — a check that scanned zero
#                  items is not a passing check.
NATIVE_BINDINGS=(
  "@next/swc|next"
  "@rolldown/binding|rolldown"
)

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

PLATFORM="${NATIVE_BINDINGS_PLATFORM:-$(node -p process.platform)}"
ARCH="${NATIVE_BINDINGS_ARCH:-$(node -p process.arch)}"

checked=0

for entry in "${NATIVE_BINDINGS[@]}"; do
  pkg_path="${entry%%|*}"
  sentinel="${entry##*|}"

  # Not installed in this tree → this binding does not apply here.
  [ -d "${NM_DIR}/${sentinel}" ] || continue
  checked=$((checked + 1))

  scope="${pkg_path%/*}"
  prefix="${pkg_path#*/}"

  # Accept the exact name or a `-<suffix>` (linux libc, windows msvc) — NOT a
  # bare prefix glob, which would let arch 'arm' match an 'arm64' package and
  # report a binding the runtime cannot load.
  BASE="${NM_DIR}/${scope}/${prefix}-${PLATFORM}-${ARCH}"
  candidates=()
  [ -d "${BASE}" ] && candidates+=("${BASE}")
  shopt -s nullglob
  for d in "${BASE}"-*; do
    [ -d "${d}" ] && candidates+=("${d}")
  done
  shopt -u nullglob

  if [ "${#candidates[@]}" -eq 0 ]; then
    echo "::error::check-native-bindings: no ${pkg_path}-${PLATFORM}-${ARCH}[-suffix] package under ${NM_DIR}/${scope} — npm silently dropped the platform-native optional dependency (npm/cli#4828 class). Fix: clear the npm cache (npm cache clean --force) and re-run npm ci." >&2
    exit 1
  fi

  found=""
  for dir in "${candidates[@]}"; do
    for f in "${dir}"/*.node; do
      if [ -e "${f}" ]; then
        found="${dir}|${f}"
        break 2
      fi
    done
  done

  if [ -z "${found}" ]; then
    echo "::error::check-native-bindings: ${pkg_path}-${PLATFORM}-${ARCH}[-suffix] package dir exists but contains no .node binary — the install is incomplete. Fix: clear the npm cache (npm cache clean --force) and re-run npm ci." >&2
    exit 1
  fi

  echo "check-native-bindings: OK — $(basename "${found%|*}") present with $(basename "${found#*|}")."
done

# Nothing applied. The gate is wired into jobs that install at least one of
# these, so an empty run means a mis-pointed path or a pre-install ordering
# mistake — never a pass.
if [ "${checked}" -eq 0 ]; then
  sentinels=""
  for entry in "${NATIVE_BINDINGS[@]}"; do
    sentinels="${sentinels}${sentinels:+, }${entry##*|}"
  done
  echo "::error::check-native-bindings: none of the declared sentinels (${sentinels}) are installed under ${NM_DIR} — mis-pointed node_modules dir refused. This gate must never report success having checked nothing." >&2
  exit 2
fi

exit 0
