#!/usr/bin/env bash
#
# Fail if any hand-written GitHub Actions workflow pins a third- or first-party
# action by a mutable tag/branch ref (e.g. `actions/checkout@v6`,
# `dtolnay/rust-toolchain@stable`) instead of a 40-hex commit SHA.
#
# A mutable ref means a compromised or maliciously re-tagged upstream action
# executes in CI with the repository token — secret exfiltration or build
# tampering (audit finding F35, #8627). SHA pins make the action content
# immutable; Dependabot's github-actions updater bumps the SHA + version comment
# forward over time, so pinning does not freeze us on stale versions.
#
# Scope: `.github/workflows/*.yml`, EXCLUDING the generated `*.lock.yml` files —
# those are produced by `gh aw compile`, which injects its own SHA pins, and are
# guarded separately by scripts/check-ghaw-lock-sync.sh. Local `./...` composite
# actions and `docker://` refs are not tag-pinnable and are skipped.
#
# Exit 0 = every action is SHA-pinned. Exit 1 = at least one mutable ref.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

fail=0
shopt -s nullglob
for f in .github/workflows/*.yml; do
  case "$f" in
    *.lock.yml) continue ;;
  esac
  # Pull every `uses:` value (strip a trailing ` # comment`). grep may match
  # nothing in a given file; `|| true` keeps `set -e` from aborting the loop.
  while IFS= read -r ref; do
    [[ -z "$ref" ]] && continue
    case "$ref" in
      ./*|docker://*) continue ;;   # local composite / docker — not tag-pinnable
    esac
    case "$ref" in
      *@*) : ;;                      # has a ref to inspect
      *) continue ;;                 # no @ref (e.g. a bare local path) — skip
    esac
    sha="${ref##*@}"
    if [[ ! "$sha" =~ ^[0-9a-f]{40}$ ]]; then
      echo "::error file=$f::Action '$ref' is pinned by mutable tag/branch '$sha'. Pin to a 40-char commit SHA with a trailing '# <version>' comment." >&2
      fail=1
    fi
  done < <(grep -hoE 'uses:[[:space:]]*[^[:space:]#]+' "$f" | sed -E 's/uses:[[:space:]]*//' || true)
done

if [[ "$fail" -ne 0 ]]; then
  echo "" >&2
  echo "One or more GitHub Actions are pinned by a mutable ref (F35, #8627)." >&2
  echo "Resolve each to a commit SHA, e.g.:" >&2
  echo "  sha=\$(gh api repos/<owner>/<repo>/commits/<tag> --jq .sha)" >&2
  echo "  uses: <owner>/<repo>@\$sha # <tag>" >&2
  exit 1
fi

echo "All hand-written workflow actions are SHA-pinned."
