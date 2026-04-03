#!/usr/bin/env bash
# Post-push hook: check for unreplied Sentry/Copilot review comments.
# Runs async after git push — outputs a warning if any PR has unreplied bot comments.

set -euo pipefail

# Extract the branch name from the push command
BRANCH=$(git branch --show-current 2>/dev/null || echo "")
[ -z "$BRANCH" ] && exit 0
[ "$BRANCH" = "main" ] && exit 0

# Find the PR number for this branch
PR=$(gh pr list --head "$BRANCH" --json number --jq '.[0].number' 2>/dev/null || echo "")
[ -z "$PR" ] && exit 0

# Count unreplied bot comments (paginated)
UNREPLIED=$(python3 -c "
import subprocess, json, sys
result = subprocess.run(
    ['gh', 'api', 'repos/Tristan578/project-forge/pulls/$PR/comments', '--paginate'],
    capture_output=True, text=True, timeout=30
)
if result.returncode != 0:
    sys.exit(0)
comments = json.loads(result.stdout)
replied_to = {c['in_reply_to_id'] for c in comments if c.get('in_reply_to_id')}
unreplied = [c for c in comments
             if c['user']['login'] in ('sentry[bot]', 'Copilot')
             and not c.get('in_reply_to_id')
             and c['id'] not in replied_to]
if unreplied:
    print(f'WARNING: PR #{int(\"$PR\")} has {len(unreplied)} unreplied bot comments after push.')
    for c in unreplied[:3]:
        print(f'  @{c[\"user\"][\"login\"]} {c.get(\"path\",\"?\")}#{c.get(\"line\") or c.get(\"original_line\",\"?\")}')
    if len(unreplied) > 3:
        print(f'  ... and {len(unreplied)-3} more')
    print('Run /resolve-pr-comments $PR to address them.')
" 2>/dev/null || true)

[ -n "$UNREPLIED" ] && echo "$UNREPLIED"
exit 0
