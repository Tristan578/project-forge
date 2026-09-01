#!/usr/bin/env bash
# Give this deploy's commit SHA a valid engine prefix on the CDN without
# rebuilding or re-uploading anything.
#
# THE BUG THIS CLOSES (#9581)
#
# cd.yml stamps every deploy with NEXT_PUBLIC_ENGINE_VERSION=${{ github.sha }},
# and useEngine.ts then resolves the engine at <cdn>/<that sha>/... But the
# upload job only ran when the engine changed -- measured, once in the last
# twelve CD runs -- so eleven deploys in twelve pointed at a prefix that was
# never written. Both the CDN path AND the same-origin fallback 404'd, and the
# engine could not load at all.
#
# WHY ALIASING RATHER THAN NOT STAMPING
#
# The cheap alternative is to stamp nothing when no upload happened, letting the
# client fall back to /latest. That trades a hard failure for an intermittent
# one: /latest is replaced by the next engine upload while older app bundles are
# still being served, so the JS glue and the WASM can disagree at runtime.
# Version pinning exists precisely to prevent that, and a skew bug is harder to
# see and harder to reproduce than a 404.
#
# When the engine did not change, the bytes already at latest/ ARE this commit's
# engine. Copying them server-side is correct by construction, costs no build,
# and leaves every deploy with an immutable prefix.
#
# FAIL CLOSED. If latest/ is missing or the copy fails, this exits non-zero so
# the deploy fails loudly rather than shipping a stamp with nothing behind it --
# which is the exact condition that produced #9581.
#
# TEST SEAM: $AWS_CLI overrides the aws binary so the suite can drive every
# branch without touching a real bucket.
set -uo pipefail

: "${ENGINE_VERSION:?ENGINE_VERSION is required}"
: "${R2_BUCKET:?R2_BUCKET is required}"

AWS="${AWS_CLI:-aws}"

# BYTE-FOR-BYTE the value upload-wasm-to-r2.sh writes on the versioned prefix.
# An aliased prefix must be indistinguishable from an uploaded one, so this
# string is deliberately not "improved" (no leading `public,`) -- it is copied
# from the real upload path and must be changed with it.
#
# The REPLACE is what makes it apply: latest/ is written with
# `max-age=60, must-revalidate`, and a plain server-side copy would carry that
# 60-second TTL onto a prefix whose whole purpose is to be immutable.
IMMUTABLE_CACHE_CONTROL="${IMMUTABLE_CACHE_CONTROL:-max-age=31536000, immutable}"

SRC="s3://${R2_BUCKET}/latest/"
DEST="s3://${R2_BUCKET}/${ENGINE_VERSION}/"

echo "Aliasing engine CDN version"
echo "  from: ${SRC}"
echo "  to:   ${DEST}"

# Refuse to alias from an empty source. `aws s3 cp --recursive` over a
# non-existent prefix EXITS 0 having copied nothing, so without this check the
# deploy would report success and still serve 404s -- the same silent shape as
# the bug being fixed.
listing="$("$AWS" s3 ls "${SRC}" --recursive 2>/dev/null)"
if [ -z "$listing" ]; then
  echo "::error::alias-wasm-cdn-version: ${SRC} is empty or unreadable — refusing to stamp ${ENGINE_VERSION} with nothing behind it" >&2
  exit 1
fi

# COPY PER CONTENT-TYPE GROUP.
#
# `--metadata-directive REPLACE` is mandatory here -- it is the only way to set
# cache-control on a server-side copy -- but REPLACE DISCARDS EVERY HEADER NOT
# RESTATED, Content-Type included. The first version of this script restated
# only cache-control, and the aliased objects were served with no Content-Type
# at all (#9593). That is not cosmetic:
#
#   * useEngine.ts loads the glue with a dynamic ES module import, and browsers
#     enforce strict MIME checking on module scripts -- an empty type is
#     REFUSED, so the engine could not load at all. The 404 became a MIME block.
#   * WebAssembly.instantiateStreaming requires application/wasm and otherwise
#     falls back to buffering the whole 95 MB module before compiling.
#
# So each group restates its own type. The values match what
# upload-wasm-to-r2.sh produces for the same files (the CLI guesses them from
# the local extension there; a server-side copy has no local file to guess from).
copy_group() {
  local pattern="$1" ctype="$2"
  if ! "$AWS" s3 cp "${SRC}" "${DEST}" \
        --recursive \
        --exclude "*" --include "${pattern}" \
        --metadata-directive REPLACE \
        --cache-control "${IMMUTABLE_CACHE_CONTROL}" \
        --content-type "${ctype}"; then
    echo "::error::alias-wasm-cdn-version: copying ${pattern} from ${SRC} to ${DEST} failed" >&2
    return 1
  fi
}

copy_group '*.wasm' 'application/wasm' || exit 1
copy_group '*.js'   'text/javascript'  || exit 1
copy_group '*.json' 'application/json' || exit 1

# PARITY, not merely non-emptiness. The copy above is driven by an explicit list
# of extensions, so a file type nobody anticipated is not copied at all -- and a
# destination that merely has SOME objects in it would hide that. Comparing
# counts turns "a new file type appeared" into a failed deploy instead of an
# engine that is missing one of its parts.
src_count="$(printf '%s
' "$listing" | grep -c . || true)"
dest_listing="$("$AWS" s3 ls "${DEST}" --recursive 2>/dev/null)"
dest_count="$(printf '%s
' "$dest_listing" | grep -c . || true)"

if [ "$dest_count" -eq 0 ]; then
  echo "::error::alias-wasm-cdn-version: ${DEST} is still empty after the copy" >&2
  exit 1
fi
if [ "$dest_count" -ne "$src_count" ]; then
  echo "::error::alias-wasm-cdn-version: copied ${dest_count} of ${src_count} objects — a file whose extension matches none of the content-type groups above was skipped. Add its group rather than relaxing this check; a partially-aliased prefix serves a broken engine." >&2
  exit 1
fi

echo "Engine ${ENGINE_VERSION} now resolves on the CDN (${dest_count} objects, typed)."
