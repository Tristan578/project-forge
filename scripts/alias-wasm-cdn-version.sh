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

# The immutable prefix wants a year-long TTL; latest/ is deliberately short-TTL,
# so the copy must REPLACE the cache-control it would otherwise inherit rather
# than propagate an alias's headers onto a pinned path.
IMMUTABLE_CACHE_CONTROL="${IMMUTABLE_CACHE_CONTROL:-public, max-age=31536000, immutable}"

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

if ! "$AWS" s3 cp "${SRC}" "${DEST}" \
      --recursive \
      --metadata-directive REPLACE \
      --cache-control "${IMMUTABLE_CACHE_CONTROL}"; then
  echo "::error::alias-wasm-cdn-version: copy from ${SRC} to ${DEST} failed" >&2
  exit 1
fi

# Verify the destination actually has objects. A copy that reports success but
# writes nothing leaves exactly the 404 this script exists to prevent.
if [ -z "$("$AWS" s3 ls "${DEST}" --recursive 2>/dev/null)" ]; then
  echo "::error::alias-wasm-cdn-version: ${DEST} is still empty after the copy" >&2
  exit 1
fi

echo "Engine ${ENGINE_VERSION} now resolves on the CDN."
