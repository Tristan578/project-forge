#!/usr/bin/env bash
set -euo pipefail

# Decide whether a Vercel production deployment is behind HEAD for a selected
# set of repository inputs. Writes changed=true|false to $GITHUB_OUTPUT when
# available and also prints the value for local callers.

project_id=${1:?usage: check-vercel-deployment-drift.sh PROJECT_ID PATH_REGEX [LABEL]}
path_regex=${2:?usage: check-vercel-deployment-drift.sh PROJECT_ID PATH_REGEX [LABEL]}
label=${3:-deployment}

: "${VERCEL_TEAM_ID:?VERCEL_TEAM_ID is required}"
: "${VERCEL_TOKEN:?VERCEL_TOKEN is required}"

api_base=${VERCEL_API_URL:-https://api.vercel.com}
response=$(curl -sS -w '\n%{http_code}' \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  "${api_base}/v6/deployments?projectId=${project_id}&teamId=${VERCEL_TEAM_ID}&target=production&state=READY&limit=1")
http_status=$(printf '%s\n' "$response" | tail -1)
body=$(printf '%s\n' "$response" | sed '$d')

if [ "$http_status" != "200" ]; then
  echo "::error::Vercel deployment lookup failed for ${label} (HTTP ${http_status})"
  exit 1
fi

deployed_sha=$(printf '%s' "$body" | jq -r '.deployments[0].meta.githubCommitSha // .deployments[0].meta.gitCommitSha // empty')
changed=true
reason="no production deployment with a Git SHA was found"

if [ -n "$deployed_sha" ]; then
  if ! git cat-file -e "${deployed_sha}^{commit}" 2>/dev/null; then
    reason="deployed commit ${deployed_sha} is not available in the checkout"
  elif ! git merge-base --is-ancestor "$deployed_sha" HEAD; then
    reason="deployed commit ${deployed_sha} is not an ancestor of HEAD"
  else
    matching_files=$(git diff --name-only "$deployed_sha" HEAD | grep -E "$path_regex" || true)
    if [ -z "$matching_files" ]; then
      changed=false
      reason="relevant inputs match deployed commit ${deployed_sha}"
    else
      reason="relevant inputs changed since deployed commit ${deployed_sha}"
      printf '%s\n' "$matching_files" | sed 's/^/  /'
    fi
  fi
fi

echo "${label}: changed=${changed} (${reason})"
echo "changed=${changed}"
if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "changed=${changed}" >> "$GITHUB_OUTPUT"
fi
