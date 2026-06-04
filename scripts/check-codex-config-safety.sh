#!/usr/bin/env bash
# check-codex-config-safety.sh — reject a COMMITTED permissive Codex CLI profile.
#
# WHAT IT GUARDS
# The committed `.codex/config.toml` must never ship the fully-unattended,
# network-open combination:
#       approval_policy = "never"   AND   network_access = true
# That pair lets a Codex agent run shell with no human approval gate while also
# reaching the network — a silent, high-blast-radius supply-chain footgun. The
# safe committed profile is approval-gated (e.g. "unless-allow-listed") with the
# network off; this guard passes on it and only trips if a permissive profile is
# committed. (Source: Codex config reference — approval_policy {untrusted,
# on-request, never}; [sandbox_workspace_write].network_access.)
#
# READS THE COMMITTED BLOB, NOT THE WORKING TREE
# A fully-permissive profile may legitimately exist as an UNCOMMITTED local
# working-tree edit (developer convenience, off-limits to tooling). Reading the
# working-tree file would (a) touch that off-limits edit and (b) false-fail
# locally while HEAD is safe. So the production path reads `git show
# HEAD:.codex/config.toml`. In CI the checkout == the ref under test, so this is
# exactly "is the committed profile permissive?".
#
# TEST SEAMS (hermetic, never touch the real file)
#   CODEX_CONFIG_PATH=<file>      read this file directly, bypass git (fixtures).
#   CODEX_CONFIG_SCAN_ROOT=<dir>  `git -C <dir> show HEAD:.codex/config.toml`.
#
# Exit 0 = safe (or no committed config); exit 1 = permissive profile committed.
# grep is fed from here-strings (`<<<`), never `echo "$big" | grep`, which takes
# SIGPIPE under `pipefail` on Linux when the payload exceeds the pipe buffer.
set -uo pipefail

ROOT="${CODEX_CONFIG_SCAN_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"

# --- load the config content -------------------------------------------------
content=""
if [ -n "${CODEX_CONFIG_PATH:-}" ]; then
  # Fixture mode: read the named file directly (missing → empty → pass).
  if [ -f "$CODEX_CONFIG_PATH" ]; then
    content="$(cat "$CODEX_CONFIG_PATH")"
  fi
else
  # Production mode: read the COMMITTED blob; never the working tree.
  content="$(git -C "$ROOT" show HEAD:.codex/config.toml 2>/dev/null || true)"
fi

if [ -z "$content" ]; then
  echo "✓ codex-config-safety: no committed .codex/config.toml to inspect — pass"
  exit 0
fi

# --- isolate ACTIVE (non-comment) lines --------------------------------------
# Drop whole-line comments (optional leading whitespace then `#`). Lines with a
# TRAILING comment are kept — the value before the `#` is still active.
active="$(grep -vE '^[[:space:]]*#' <<<"$content" || true)"

# --- detect the two dangerous keys, exact-token, quote/space/comment tolerant -
# A dangerous key may START a line, OR appear inside a single-line TOML inline
# table where it follows `{` or `,` — e.g. `sandbox = { network_access = true }`
# or `s = { approval_policy = "never", network_access = true }`. Inline tables are
# semantically identical to [section] tables in TOML 1.0, so the dangerous combo
# expressed that way must still trip. Anchoring the key to one of those three
# boundaries closes the inline-table evasion while staying precise: a substring
# like `my_approval_policy` / `xnetwork_access` has no `{`/`,`/line-start directly
# in front of the real key name, so it cannot match.
KEY_BOUNDARY="(^[[:space:]]*|[{,][[:space:]]*)"
# approval_policy = never — the value may be a basic string ("never"), a literal
# string ('never'), or the single-line triple-quoted forms ("""never""" /
# '''never'''), all identical to "never" in TOML 1.0. A closing delimiter
# immediately after `never` is required so `"never-mind"` does NOT match. A TRUE
# multi-line triple-quoted form (the value spread across newlines) is out of
# scope: TOML keeps the embedded newlines, so the parsed value is not the token
# `never` and Codex would not read it as the permissive setting. A grep guard
# cannot parse TOML anyway, so the committed-blob check plus human review remain
# the backstop for exotic encodings — this closes the silent single-line slip.
RE_NEVER="${KEY_BOUNDARY}approval_policy[[:space:]]*=[[:space:]]*(\"\"\"never\"\"\"|'''never'''|\"never\"|'never')"
# network_access = true — `true` must be a whole token (followed by whitespace,
# `#`, an inline-table `}`/`,`, or EOL) so `truely` / `true_thing` do not match.
# `true` is matched case-sensitively because TOML booleans are lowercase, so
# `TRUE` is correctly treated as a non-boolean and passes.
RE_NETWORK="${KEY_BOUNDARY}network_access[[:space:]]*=[[:space:]]*true([[:space:]]|#|}|,|\$)"

has_never=0
has_network=0
if grep -Eq "$RE_NEVER"   <<<"$active"; then has_never=1;   fi
if grep -Eq "$RE_NETWORK" <<<"$active"; then has_network=1; fi

if [ "$has_never" -eq 1 ] && [ "$has_network" -eq 1 ]; then
  src="${CODEX_CONFIG_PATH:-$ROOT/.codex/config.toml (committed HEAD)}"
  echo "::error::CODEX-PERMISSIVE: committed Codex profile is fully unattended AND network-open" >&2
  echo "  file:   $src" >&2
  echo "  found:  approval_policy = \"never\"  +  network_access = true" >&2
  echo "" >&2
  echo "  This pair lets a Codex agent run shell with no human approval while" >&2
  echo "  reaching the network — it must never be the COMMITTED profile." >&2
  echo "  Remediation: commit an approval-gated profile (e.g." >&2
  echo "  approval_policy = \"unless-allow-listed\") and/or set network_access = false." >&2
  echo "  A permissive profile may remain as an UNCOMMITTED local edit." >&2
  exit 1
fi

echo "✓ codex-config-safety: committed profile is not the unattended+network-open combo — pass"
exit 0
