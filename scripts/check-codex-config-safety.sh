#!/usr/bin/env bash
# check-codex-config-safety.sh — reject a COMMITTED permissive Codex CLI profile.
#
# WHAT IT GUARDS
# The committed `.codex/config.toml` must never ship the fully-unattended,
# network-open combination:
#       approval_policy = "never"   AND   network_access = true
# That pair lets a Codex agent run shell with no human approval gate while also
# reaching the network — a silent, high-blast-radius supply-chain footgun. The
# safe committed profile is approval-gated (e.g. "untrusted") with the
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
  echo "  approval_policy = \"untrusted\") and/or set network_access = false." >&2
  echo "  A permissive profile may remain as an UNCOMMITTED local edit." >&2
  exit 1
fi

# --- reject a committed CREDENTIAL VALUE -------------------------------------
# This file names the MCP servers a Codex session gets, and the repository is
# public. Codex has no `${VAR}` interpolation, so the only correct way to give a
# server a secret is `env_vars = ["NAME", …]` — a list of variable NAMES it
# forwards from the environment that starts it. A literal secret pasted in here
# would be published.
#
# This replaces an earlier `permissions.deny` entry that merely stopped ONE agent
# from editing the file. That guarded the writer; this guards the CONTENT, so it
# also catches a human, another tool, or the Codex app itself writing a secret.
#
# TWO INDEPENDENT RULES, both over ACTIVE lines only:
#   1. A well-known credential PREFIX anywhere (provider token shapes).
#   2. A key whose NAME says secret (…KEY/TOKEN/SECRET/PASSWORD/PASSWD/CREDENTIAL)
#      assigned a non-empty quoted literal. `env_vars = [...]` cannot trip this:
#      the key there is `env_vars`, and the names live in the VALUE. A
#      `${PLACEHOLDER}` value is allowed, since it carries nothing.
CRED_SHAPES='(sk-[A-Za-z0-9_-]{16,}|sk_(live|test)_[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|napi_[A-Za-z0-9]{20,}|AIza[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|-----BEGIN [A-Z ]*PRIVATE KEY-----)'
# A secret-ish key = value "literal". The value must contain a non-space character
# and must not be a ${…} placeholder.
SECRET_KEY_RE='(^[[:space:]]*|[{,][[:space:]]*)[A-Za-z_][A-Za-z0-9_]*(KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL)[[:space:]]*=[[:space:]]*("|'"'"')[^"'"'"']'

cred_hit=""
if grep -Eqi "$CRED_SHAPES" <<<"$active"; then
  cred_hit="a provider credential shape"
elif grep -Eq "$SECRET_KEY_RE" <<<"$active" && ! grep -Eq "$SECRET_KEY_RE"'*\$\{' <<<"$active"; then
  # Re-check line by line so a ${…} placeholder on one line does not excuse a
  # literal on another.
  while IFS= read -r line; do
    grep -Eq "$SECRET_KEY_RE" <<<"$line" || continue
    grep -Eq '=[[:space:]]*("|'"'"')\$\{[A-Za-z0-9_]+\}("|'"'"')[[:space:]]*$' <<<"$line" && continue
    cred_hit="a secret-named key assigned a literal value"
    break
  done <<<"$active"
fi

if [ -n "$cred_hit" ]; then
  src="${CODEX_CONFIG_PATH:-$ROOT/.codex/config.toml (committed HEAD)}"
  echo "::error::CODEX-SECRET: committed Codex config appears to contain a credential" >&2
  echo "  file:   $src" >&2
  echo "  found:  $cred_hit" >&2
  echo "" >&2
  echo "  This repository is public and this file is committed, so a literal" >&2
  echo "  secret here is published. Codex has no \${VAR} interpolation: pass" >&2
  echo "  secrets by NAME instead, with env_vars = [\"MY_TOKEN\"], which Codex" >&2
  echo "  forwards from the environment that starts it." >&2
  echo "  If this is a false positive (a non-secret value whose key name merely" >&2
  echo "  ends in _KEY), rename the key or move it out of this file." >&2
  exit 1
fi

echo "✓ codex-config-safety: committed profile is not the unattended+network-open combo, and carries no credential — pass"
exit 0
