#!/usr/bin/env bash
#
# Validate that every .changeset/*.md targets a real, versionable workspace
# package. A changeset whose front-matter names a non-workspace package (most
# commonly the root package "spawnforge", which is NOT in `workspaces`) makes
# `changeset version` throw "Found changeset <name> for package <pkg> which is
# not in the workspace" during release-plan assembly, latently breaking the
# Release workflow.
#
# This is the durable recurrence guard for that defect (#8325 → #8396 → #8732).
# The existing changeset-check gate only verifies that *a* changeset file was
# added; it never validated the package name, which is how the bad files kept
# landing. Run from CI (see .github/workflows/changeset-check.yml) and locally.
#
# Exit 0 = all changesets valid. Exit 1 = at least one invalid package name.

set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

# Build the set of valid versionable package names from the package.json `name`
# of every directory matched by the root `workspaces` globs.
# Populated via a read loop (not `mapfile`, which is bash 4+ — macOS ships 3.2).
# The `|| [[ -n "$_name" ]]` keeps the final entry when node's output has no
# trailing newline (the classic while-read last-line drop).
valid_names=()
while IFS= read -r _name || [[ -n "$_name" ]]; do
  [[ -n "$_name" ]] && valid_names+=("$_name")
done < <(node -e '
  const fs = require("fs");
  const path = require("path");
  const root = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const dirs = new Set();
  for (const g of (root.workspaces || [])) {
    if (g.endsWith("/*")) {
      const base = g.slice(0, -2);
      if (fs.existsSync(base)) {
        for (const d of fs.readdirSync(base)) dirs.add(path.join(base, d));
      }
    } else {
      dirs.add(g);
    }
  }
  const names = [];
  for (const d of dirs) {
    const pj = path.join(d, "package.json");
    if (!fs.existsSync(pj)) continue;
    try {
      const n = JSON.parse(fs.readFileSync(pj, "utf8")).name;
      if (n) names.push(n);
    } catch { /* ignore unreadable package.json */ }
  }
  process.stdout.write(names.join("\n"));
')

if [[ "${#valid_names[@]}" -eq 0 ]]; then
  echo "::error::Could not resolve any workspace package names from package.json — check the workspaces config." >&2
  exit 1
fi

is_valid() {
  local name="$1"
  local v
  for v in "${valid_names[@]}"; do
    [[ "$v" == "$name" ]] && return 0
  done
  return 1
}

fail=0
shopt -s nullglob
for f in .changeset/*.md; do
  [[ "$(basename "$f")" == "README.md" ]] && continue
  # Extract package names from the YAML front-matter only (between the first two
  # `---` fences), so a `---` horizontal rule or the word "spawnforge" appearing
  # in the prose body is never misread as a package declaration. Handles every
  # YAML key quote style changesets emit — "pkg": bump, 'pkg': bump, and bare
  # pkg: bump. The key is the text before the first colon; surrounding quotes are
  # stripped in a second pass. We deliberately avoid an in-pattern backreference
  # (e.g. matching quote pairs) because that is a GNU-sed extension BSD/macOS sed
  # silently no-ops on — which would make this a false-PASS gate locally.
  pkgs=$(awk 'NR==1 && $0=="---"{infm=1; next} infm && $0=="---"{exit} infm{print}' "$f" \
         | sed -nE 's/^[[:space:]]*([^:]+):.*/\1/p' \
         | sed -E "s/^[[:space:]]+//; s/[[:space:]]+\$//; s/^[\"']//; s/[\"']\$//" \
         || true)
  for p in $pkgs; do
    if ! is_valid "$p"; then
      echo "::error file=$f::Changeset targets \"$p\", which is not a workspace package. Valid packages: ${valid_names[*]}" >&2
      fail=1
    fi
  done
done

if [[ "$fail" -ne 0 ]]; then
  echo "" >&2
  echo "One or more changesets target a non-workspace package — 'changeset version' would fail during release assembly (#8732)." >&2
  echo "Code changes under web/ should use \"web\": patch (the dominant convention)." >&2
  exit 1
fi

echo "All changesets target valid workspace packages (${valid_names[*]})."
