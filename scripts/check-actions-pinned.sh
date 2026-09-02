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
mutable_fail=0
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
      mutable_fail=1
    fi
  done < <(grep -hoE 'uses:[[:space:]]*[^[:space:]#]+' "$f" | sed -E 's/uses:[[:space:]]*//' || true)
done

# The two halves of the Chromatic gate must run the SAME CLI. quality-gates.yml
# writes the comparison build and chromatic-baseline.yml writes the baseline it
# is compared against (PF-1345 / #9621); a version skew between them means the
# reference snapshots were captured by different code than the ones being
# diffed. Dependabot bumps one file per PR, so nothing else notices the split.
# `/dev/null` is a deliberate sentinel argument on both greps: `nullglob` is
# set above, so an empty .github/workflows/ collapses the glob to nothing and a
# file-less grep would read STDIN and hang the gate instead of failing it.
chromatic_pins="$(grep -hoE 'chromaui/action@[0-9a-f]{40}' .github/workflows/*.yml /dev/null 2>/dev/null | sort -u || true)"
chromatic_count="$(printf '%s' "$chromatic_pins" | grep -c . || true)"
chromatic_files="$(grep -lE 'chromaui/action@' .github/workflows/*.yml /dev/null 2>/dev/null || true)"

# The comparer cannot be the only half. If some workflow runs Chromatic at all,
# a baseline writer must exist too — without one there is no ancestor build and
# every PR reports 100% of stories as unaccepted, forever and silently (#9621).
# Removing Chromatic entirely disables this check rather than tripping it.
if [[ -n "$chromatic_files" ]] && ! grep -q 'chromatic-baseline.yml' <<<"$chromatic_files"; then
  echo "::error::A workflow runs chromaui/action but .github/workflows/chromatic-baseline.yml does not. Without a baseline written on main, the PR-side UI Tests check has nothing to diff against (PF-1345 / #9621)." >&2
  fail=1
fi

if [[ "$chromatic_count" -gt 1 ]]; then
  echo "::error::chromaui/action is pinned at $chromatic_count different SHAs. The baseline writer and the PR comparer must share one pin:" >&2
  while IFS= read -r pin; do echo "  $pin" >&2; done <<<"$chromatic_pins"
  fail=1
fi

if [[ "$mutable_fail" -ne 0 ]]; then
  echo "" >&2
  echo "One or more GitHub Actions are pinned by a mutable ref (F35, #8627)." >&2
  echo "Resolve each to a commit SHA, e.g.:" >&2
  echo "  sha=\$(gh api repos/<owner>/<repo>/commits/<tag> --jq .sha)" >&2
  echo "  uses: <owner>/<repo>@\$sha # <tag>" >&2
fi

if [[ "$fail" -ne 0 ]]; then
  exit 1
fi

echo "All hand-written workflow actions are SHA-pinned."
