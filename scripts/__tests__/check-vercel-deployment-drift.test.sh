#!/usr/bin/env bash
set -euo pipefail

repo_root=$(git rev-parse --show-toplevel)
gate="$repo_root/scripts/check-vercel-deployment-drift.sh"
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT

git -C "$tmp" init -q
git -C "$tmp" config user.email test@example.com
git -C "$tmp" config user.name Test
printf 'one\n' > "$tmp/app.txt"
printf 'one\n' > "$tmp/other.txt"
git -C "$tmp" add .
git -C "$tmp" commit -qm initial
deployed_sha=$(git -C "$tmp" rev-parse HEAD)

mkdir -p "$tmp/bin"
cat > "$tmp/bin/curl" <<EOF
#!/usr/bin/env bash
printf '{"deployments":[{"meta":{"githubCommitSha":"$deployed_sha"}}]}\\n200'
EOF
chmod +x "$tmp/bin/curl"
cat > "$tmp/bin/jq" <<EOF
#!/usr/bin/env bash
cat >/dev/null
printf '%s\\n' '$deployed_sha'
EOF
chmod +x "$tmp/bin/jq"

run_gate() {
  (cd "$tmp" && PATH="$tmp/bin:$PATH" VERCEL_TEAM_ID=team VERCEL_TOKEN=token \
    bash "$gate" project '^app\.txt$' test)
}

output=$(run_gate)
grep -q 'changed=false' <<<"$output"

printf 'two\n' > "$tmp/other.txt"
git -C "$tmp" add .
git -C "$tmp" commit -qm unrelated
output=$(run_gate)
grep -q 'changed=false' <<<"$output"

printf 'two\n' > "$tmp/app.txt"
git -C "$tmp" add .
git -C "$tmp" commit -qm relevant
output=$(run_gate)
grep -q 'changed=true' <<<"$output"

cat > "$tmp/bin/curl" <<'EOF'
#!/usr/bin/env bash
printf '{"error":"unauthorized"}\n401'
EOF
chmod +x "$tmp/bin/curl"
if run_gate >/dev/null 2>&1; then
  echo 'expected an API failure to fail closed' >&2
  exit 1
fi

echo 'check-vercel-deployment-drift tests passed'
