#!/usr/bin/env python3
"""
github_project_sync.py - Bidirectional sync between local taskboard and GitHub Projects v2

Usage:
  python3 github_project_sync.py push       # Push changed tickets to GitHub (todo + in_progress + newly done)
  python3 github_project_sync.py push-all   # Push ALL tickets including done
  python3 github_project_sync.py pull       # Pull GitHub Project changes to local taskboard
  python3 github_project_sync.py status     # Show sync status

Designed to be called from Claude Code hooks:
  - Stop hook calls 'push' to sync outbound changes after each response
  - SessionStart hook calls 'pull' to sync inbound changes at session start
  - Skills call 'push-all' or 'pull' for manual full sync

Requires: gh CLI (authenticated), taskboard API at localhost:3010
"""

import hashlib
import json
import os
import re
import subprocess
import sys
import urllib.request
import urllib.error
from datetime import datetime, timezone
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
CONFIG_PATH = SCRIPT_DIR / "github-sync-config.json"
MAP_PATH = SCRIPT_DIR / "github-project-map.json"
TB_API = "http://localhost:3010/api"


def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


_resolved_cache = {}


def resolve_team_id(config):
    """Resolve allowedTeamName to a team ID via the taskboard API.

    Creates the team if it doesn't exist. Caches the result for the
    duration of this process to avoid repeated API calls.
    """
    if "team" in _resolved_cache:
        return _resolved_cache["team"]

    team_name = config.get("allowedTeamName")
    if not team_name:
        result = config.get("allowedTeamId")
        _resolved_cache["team"] = result
        return result

    teams = tb_get("/teams")
    if teams:
        for team in teams:
            if team.get("name", "").lower() == team_name.lower():
                _resolved_cache["team"] = team["id"]
                return team["id"]

    # Team not found — create it
    try:
        new_team = tb_post("/teams", {"name": team_name})
        tid = new_team.get("id")
        if tid:
            print(f"  [bootstrap] Created team: {team_name} ({tid})")
            _resolved_cache["team"] = tid
            return tid
    except Exception as e:
        print(f"  [bootstrap] Failed to create team {team_name}: {e}", file=sys.stderr)

    _resolved_cache["team"] = None
    return None


def resolve_project_id(config):
    """Resolve allowedProjectName to a project ID via the taskboard API.

    Creates the project if it doesn't exist. Caches the result for the
    duration of this process to avoid repeated API calls.
    """
    if "project" in _resolved_cache:
        return _resolved_cache["project"]

    project_name = config.get("allowedProjectName")
    if not project_name:
        result = config.get("localProjectId", "01KJEE8R1XXFF0CZT1WCSTGRDP")
        _resolved_cache["project"] = result
        return result

    projects = tb_get("/projects")
    if projects:
        for proj in projects:
            if proj.get("name", "").lower() == project_name.lower():
                _resolved_cache["project"] = proj["id"]
                return proj["id"]

    # Project not found — create it
    try:
        prefix = config.get("allowedProjectPrefix", "PF")
        new_proj = tb_post("/projects", {"name": project_name, "prefix": prefix})
        pid = new_proj.get("id")
        if pid:
            print(f"  [bootstrap] Created project: {project_name} ({pid})")
            _resolved_cache["project"] = pid
            return pid
    except Exception as e:
        print(f"  [bootstrap] Failed to create project {project_name}: {e}", file=sys.stderr)

    fallback = config.get("localProjectId", "01KJEE8R1XXFF0CZT1WCSTGRDP")
    _resolved_cache["project"] = fallback
    return fallback


def load_map():
    if MAP_PATH.exists():
        try:
            with open(MAP_PATH) as f:
                return json.load(f)
        except (json.JSONDecodeError, IOError):
            pass
    return {"lastSync": None, "tickets": {}}


def save_map(mapping):
    mapping["lastSync"] = datetime.now(timezone.utc).isoformat()
    with open(MAP_PATH, "w") as f:
        json.dump(mapping, f, indent=2)
        f.write("\n")


# ---------------------------------------------------------------------------
# V2 body format: regex constants
# ---------------------------------------------------------------------------

METADATA_RE = re.compile(
    r"<!-- SPAWNFORGE_METADATA\n(.*?)\nSPAWNFORGE_METADATA -->",
    re.DOTALL,
)
OLD_TASKBOARD_RE = re.compile(
    r"\*\*Taskboard:\*\*\s*PF-(\d+)\s*\(([A-Z0-9]+)\)"
)
SUBTASK_RE = re.compile(r"^[ \t]*[-*] \[([ xX])\] (.+)$", re.MULTILINE)


# ---------------------------------------------------------------------------
# V2 body format: helpers
# ---------------------------------------------------------------------------

def compute_body_hash(ticket):
    """SHA-256 of description+priority+teamId, first 16 hex chars."""
    desc = ticket.get("description", "") or ""
    priority = ticket.get("priority", "") or ""
    team_id = ticket.get("teamId", "") or ""
    raw = f"{desc}|{priority}|{team_id}"
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def compute_subtask_hash(subtasks):
    """SHA-256 of sorted subtask titles+completed states."""
    if not subtasks:
        return hashlib.sha256(b"").hexdigest()[:16]
    items = sorted(
        f"{s.get('title', '')}:{s.get('completed', False)}" for s in subtasks
    )
    raw = "|".join(items)
    return hashlib.sha256(raw.encode()).hexdigest()[:16]


def format_github_body(ticket):
    """Build v2 body with subtask checkboxes + metadata block."""
    priority = ticket.get("priority", "medium") or "medium"
    desc = ticket.get("description", "") or ""
    tid = ticket.get("id", "")
    number = ticket.get("number", 0)
    team_id = ticket.get("teamId", "") or ""
    subtasks = ticket.get("subtasks", [])
    project_id = ticket.get("projectId", "01KJEE8R1XXFF0CZT1WCSTGRDP")

    parts = [f"**Priority:** {priority}", ""]

    if desc.strip():
        parts.append(desc.strip())
        parts.append("")

    if subtasks:
        parts.append("## Subtasks")
        for st in subtasks:
            check = "x" if st.get("completed") else " "
            title = st.get("title", "Untitled")
            parts.append(f"- [{check}] {title}")
        parts.append("")

    body_hash = compute_body_hash(ticket)
    subtask_hash = compute_subtask_hash(subtasks)

    metadata = {
        "version": 2,
        "ticketId": tid,
        "number": number,
        "priority": priority,
        "teamId": team_id,
        "projectId": project_id,
        "bodyHash": body_hash,
        "subtaskHash": subtask_hash,
    }

    parts.append("---")
    parts.append("<!-- SPAWNFORGE_METADATA")
    parts.append(json.dumps(metadata, indent=2))
    parts.append("SPAWNFORGE_METADATA -->")

    return "\n".join(parts)


def parse_github_body(body):
    """Parse v2 metadata block, fall back to v1 **Taskboard:** regex.

    Returns dict with: ticketId, number, priority, teamId, description,
    subtasks (list of {title, completed}), bodyHash, subtaskHash, version.
    Returns None if no metadata found.
    """
    if not body:
        return None

    # Try v2 first
    m = METADATA_RE.search(body)
    if m:
        try:
            meta = json.loads(m.group(1))
        except (json.JSONDecodeError, ValueError):
            meta = {}

        # Extract description: everything between priority line and ## Subtasks or ---
        desc = ""
        lines = body.split("\n")
        desc_lines = []
        in_desc = False
        for line in lines:
            if line.startswith("**Priority:**"):
                in_desc = True
                continue
            if in_desc:
                if line.startswith("## Subtasks") or line.strip() == "---":
                    break
                desc_lines.append(line)
            # If we hit the metadata block, stop
            if "<!-- SPAWNFORGE_METADATA" in line:
                break
        desc = "\n".join(desc_lines).strip()

        # Extract subtasks from checkboxes
        subtasks = []
        for sm in SUBTASK_RE.finditer(body):
            completed = sm.group(1).lower() == "x"
            subtasks.append({"title": sm.group(2).strip(), "completed": completed})

        return {
            "version": meta.get("version", 2),
            "ticketId": meta.get("ticketId", ""),
            "number": meta.get("number", 0),
            "priority": meta.get("priority", ""),
            "teamId": meta.get("teamId", ""),
            "projectId": meta.get("projectId", ""),
            "bodyHash": meta.get("bodyHash", ""),
            "subtaskHash": meta.get("subtaskHash", ""),
            "description": desc,
            "subtasks": subtasks,
        }

    # Fall back to v1
    m = OLD_TASKBOARD_RE.search(body)
    if m:
        return {
            "version": 1,
            "ticketId": m.group(2),
            "number": int(m.group(1)),
            "priority": "",
            "teamId": "",
            "projectId": "",
            "bodyHash": "",
            "subtaskHash": "",
            "description": "",
            "subtasks": [],
        }

    return None


def sync_subtasks_from_github(ticket_id, gh_subtasks):
    """Match subtasks by title, create missing, update completion via PUT."""
    local_ticket = tb_get(f"/tickets/{ticket_id}")
    if not local_ticket:
        return
    local_subtasks = local_ticket.get("subtasks", [])
    local_by_title = {s.get("title", ""): s for s in local_subtasks}

    for gh_st in gh_subtasks:
        title = gh_st.get("title", "")
        completed = gh_st.get("completed", False)

        if title in local_by_title:
            local_st = local_by_title[title]
            if local_st.get("completed", False) != completed:
                # Toggle subtask completion
                st_id = local_st.get("id", "")
                if st_id:
                    try:
                        tb_put(f"/tickets/{ticket_id}/subtasks/{st_id}", {
                            "completed": completed,
                        })
                    except Exception:
                        pass
        else:
            # Create missing subtask
            try:
                tb_post(f"/tickets/{ticket_id}/subtasks", {
                    "title": title,
                    "completed": completed,
                })
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Taskboard API helpers
# ---------------------------------------------------------------------------

def tb_available():
    try:
        urllib.request.urlopen(f"{TB_API}/board", timeout=2)
        return True
    except Exception:
        return False


def tb_get(path):
    try:
        resp = urllib.request.urlopen(f"{TB_API}{path}", timeout=5)
        return json.loads(resp.read())
    except Exception:
        return None


def tb_post(path, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{TB_API}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    resp = urllib.request.urlopen(req, timeout=10)
    return json.loads(resp.read())


def tb_put(path, data):
    body = json.dumps(data).encode()
    req = urllib.request.Request(
        f"{TB_API}{path}",
        data=body,
        headers={"Content-Type": "application/json"},
        method="PUT",
    )
    resp = urllib.request.urlopen(req, timeout=10)
    return json.loads(resp.read())


# ---------------------------------------------------------------------------
# GitHub helpers (via gh CLI)
# ---------------------------------------------------------------------------

def gh_run(args, timeout=30):
    result = subprocess.run(
        args, capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(f"gh failed: {result.stderr.strip()}")
    return result.stdout


def gh_graphql(query, variables=None, timeout=30):
    cmd = ["gh", "api", "graphql", "-f", f"query={query}"]
    if variables:
        cmd.extend(["-F", f"variables={json.dumps(variables)}"])
    result = subprocess.run(
        cmd,
        capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=timeout,
    )
    if result.returncode != 0:
        raise RuntimeError(f"GraphQL failed: {result.stderr.strip()}")
    data = json.loads(result.stdout)
    if "errors" in data:
        raise RuntimeError(f"GraphQL errors: {data['errors']}")
    return data


def gh_get_project_items(config):
    """Fetch all items from the GitHub Project."""
    output = gh_run([
        "gh", "project", "item-list", str(config["projectNumber"]),
        "--owner", config["owner"], "--format", "json", "--limit", "1000",
    ])
    return json.loads(output)


def gh_create_issue_and_add_to_project(config, title, body="", labels=None):
    """Create a real GitHub Issue and add it to the GitHub Project.

    Returns (project_item_id, issue_number).
    Real issues appear as proper items (not drafts) on the project board.
    """
    owner = config["owner"]
    repo = config["repo"]

    # Step 1: Create a real GitHub Issue
    create_args = [
        "gh", "issue", "create",
        "--repo", f"{owner}/{repo}",
        "--title", title,
        "--body", body or "",
    ]
    if labels:
        for label in labels:
            create_args.extend(["--label", label])

    result = subprocess.run(
        create_args,
        capture_output=True, text=True, encoding="utf-8",
        errors="replace", timeout=30,
    )
    if result.returncode != 0:
        raise RuntimeError(f"Issue creation failed: {result.stderr.strip()}")

    # Parse issue URL to extract issue number (output is URL like https://github.com/owner/repo/issues/123)
    issue_url = result.stdout.strip()
    issue_number = int(issue_url.rstrip("/").split("/")[-1])

    # Step 2: Add the issue to the GitHub Project
    add_result = gh_run([
        "gh", "project", "item-add", str(config["projectNumber"]),
        "--owner", owner,
        "--url", issue_url,
        "--format", "json",
    ])
    item_data = json.loads(add_result)
    item_id = item_data.get("id", "")

    if not item_id:
        raise RuntimeError(f"Failed to get project item ID for issue #{issue_number}")

    return item_id, issue_number


def gh_set_status(config, item_id, local_status):
    """Set the Status field on a GitHub Project item."""
    option_id = config["statusOptions"].get(local_status)
    if not option_id:
        return
    gh_run([
        "gh", "project", "item-edit",
        "--project-id", config["projectId"],
        "--id", item_id,
        "--field-id", config["statusFieldId"],
        "--single-select-option-id", option_id,
    ])


def gh_update_issue(config, issue_number, title=None, body=None):
    """Update a real GitHub Issue's title or body."""
    owner = config["owner"]
    repo = config["repo"]
    args = [
        "gh", "issue", "edit", str(issue_number),
        "--repo", f"{owner}/{repo}",
    ]
    if title:
        args.extend(["--title", title])
    if body:
        args.extend(["--body", body])
    if len(args) > 5:  # only run if there's something to update
        gh_run(args)


# ---------------------------------------------------------------------------
# Status mapping
# ---------------------------------------------------------------------------

def local_to_github(config, local_status):
    return config["localToGithubStatus"].get(local_status, "Todo")


def github_to_local(config, github_status):
    reverse = {v: k for k, v in config["localToGithubStatus"].items()}
    return reverse.get(github_status, "todo")


# ---------------------------------------------------------------------------
# PUSH: local taskboard → GitHub Project
# ---------------------------------------------------------------------------

def push(include_done=False):
    config = load_config()
    mapping = load_map()
    tmap = mapping.get("tickets", {})
    project_id = resolve_project_id(config)

    allowed_team = resolve_team_id(config)

    tickets = tb_get(f"/tickets?project={project_id}")
    if tickets is None:
        print("[SYNC] Taskboard API unavailable — skipping push")
        return

    created = 0
    updated = 0
    skipped = 0
    filtered = 0
    errors = 0
    upgrades_needed = 0

    for ticket in tickets:
        tid = ticket["id"]
        status = ticket.get("status", "todo")
        title = ticket.get("title", "Untitled")
        number = ticket.get("number", 0)
        display = f"PF-{number}: {title}" if number else title

        # Team filter: only push tickets assigned to the allowed team
        if allowed_team:
            ticket_team = ticket.get("teamId") or ""
            if ticket_team and ticket_team != allowed_team:
                filtered += 1
                continue

        # Skip done tickets that were already synced as done
        # Always sync newly-done tickets (status changed) or never-synced tickets
        if status == "done" and not include_done:
            if tid in tmap and tmap[tid].get("lastLocalStatus") == "done":
                skipped += 1
                continue

        # Fetch full ticket with subtasks for body generation
        full_ticket = tb_get(f"/tickets/{tid}")
        if full_ticket is None:
            full_ticket = ticket
        # Ensure id is set for format_github_body
        full_ticket["id"] = tid

        cur_body_hash = compute_body_hash(full_ticket)
        cur_subtask_hash = compute_subtask_hash(full_ticket.get("subtasks", []))

        if tid not in tmap:
            # --- New ticket: create real GitHub Issue and add to project ---
            try:
                body = format_github_body(full_ticket)

                item_id, gh_issue_number = gh_create_issue_and_add_to_project(
                    config, display, body
                )
                gh_set_status(config, item_id, status)

                tmap[tid] = {
                    "githubItemId": item_id,
                    "githubIssueNumber": gh_issue_number,
                    "lastLocalStatus": status,
                    "lastGithubStatus": local_to_github(config, status),
                    "title": display,
                    "number": number,
                    "bodyHash": cur_body_hash,
                    "subtaskHash": cur_subtask_hash,
                    "metadataVersion": 2,
                }
                created += 1
                print(f"  + {display} [{status}]")
            except Exception as e:
                errors += 1
                print(f"  ! Create failed {display}: {e}", file=sys.stderr)
        else:
            # --- Existing ticket: check status, body, subtask, or format changes ---
            entry = tmap[tid]
            status_changed = entry.get("lastLocalStatus") != status
            body_changed = entry.get("bodyHash") != cur_body_hash
            subtask_changed = entry.get("subtaskHash") != cur_subtask_hash
            needs_v2_upgrade = entry.get("metadataVersion") != 2

            if not (status_changed or body_changed or subtask_changed or needs_v2_upgrade):
                skipped += 1
                continue

            # Rate limit guard for format upgrades
            if needs_v2_upgrade and not (status_changed or body_changed or subtask_changed):
                upgrades_needed += 1
                if not include_done and upgrades_needed > 10:
                    continue  # defer bulk upgrades to push-all

            try:
                # Rebuild body in v2 format
                body = format_github_body(full_ticket)
                gh_issue_num = entry.get("githubIssueNumber")
                if gh_issue_num:
                    gh_update_issue(config, gh_issue_num, body=body)
                else:
                    # Legacy draft/project item without issue number — skip body update
                    # Body updates require a real GitHub Issue number.
                    # New tickets use real issues; legacy items will get their
                    # githubIssueNumber populated when pull() re-links them.
                    pass

                if status_changed:
                    gh_set_status(config, entry["githubItemId"], status)

                entry["lastLocalStatus"] = status
                entry["lastGithubStatus"] = local_to_github(config, status)
                entry["bodyHash"] = cur_body_hash
                entry["subtaskHash"] = cur_subtask_hash
                entry["metadataVersion"] = 2
                updated += 1

                reasons = []
                if status_changed:
                    reasons.append(f"status->{status}")
                if body_changed:
                    reasons.append("body")
                if subtask_changed:
                    reasons.append("subtasks")
                if needs_v2_upgrade:
                    reasons.append("v2 upgrade")
                print(f"  ~ {display} [{', '.join(reasons)}]")
            except Exception as e:
                errors += 1
                print(f"  ! Update failed {display}: {e}", file=sys.stderr)

    if upgrades_needed > 10 and not include_done:
        print(f"  [!] {upgrades_needed} tickets need v2 format upgrade — run push-all to upgrade all")

    mapping["tickets"] = tmap
    save_map(mapping)

    if filtered:
        print(f"  [filter] {filtered} tickets skipped (wrong team)")

    if created or updated or errors:
        parts = []
        if created:
            parts.append(f"{created} created")
        if updated:
            parts.append(f"{updated} updated")
        if errors:
            parts.append(f"{errors} errors")
        print(f"[SYNC->GH] {', '.join(parts)}")


# ---------------------------------------------------------------------------
# PULL: GitHub Project → local taskboard
# ---------------------------------------------------------------------------

def pull():
    config = load_config()
    mapping = load_map()
    tmap = mapping.get("tickets", {})
    project_id = resolve_project_id(config)

    if not tb_available():
        print("[SYNC] Taskboard API unavailable — skipping pull")
        return

    try:
        gh_data = gh_get_project_items(config)
    except Exception as e:
        print(f"[SYNC] GitHub fetch failed: {e}", file=sys.stderr)
        return

    allowed_team = resolve_team_id(config)

    items = gh_data.get("items", [])

    # Build reverse map: GitHub item ID → local ticket ID
    reverse = {e["githubItemId"]: tid for tid, e in tmap.items()}

    created = 0
    updated = 0
    relinked = 0
    skipped = 0
    filtered = 0
    errors = 0

    for item in items:
        item_id = item.get("id", "")
        gh_status = item.get("status", "") or ""
        title = item.get("title", "")

        # Prefer content title for issues/PRs
        content = item.get("content") or {}
        if content.get("title"):
            title = content["title"]

        if not title:
            skipped += 1
            continue

        local_status = github_to_local(config, gh_status)
        body = content.get("body", "") if content else ""
        parsed = parse_github_body(body)

        if item_id in reverse:
            # --- Tracked item: check status + body + subtask changes ---
            tid = reverse[item_id]
            entry = tmap[tid]
            any_change = False

            # Status change
            if entry.get("lastGithubStatus") != gh_status:
                try:
                    tb_post(f"/tickets/{tid}/move", {"status": local_status})
                    entry["lastLocalStatus"] = local_status
                    entry["lastGithubStatus"] = gh_status
                    any_change = True
                except Exception as e:
                    errors += 1
                    print(f"  ! Local status update failed {title}: {e}", file=sys.stderr)

            if parsed and parsed.get("version") == 2:
                # Body hash change — update local description/priority
                remote_body_hash = parsed.get("bodyHash", "")
                if remote_body_hash and entry.get("bodyHash") != remote_body_hash:
                    update_fields = {}
                    if parsed.get("description"):
                        update_fields["description"] = parsed["description"]
                    if parsed.get("priority"):
                        update_fields["priority"] = parsed["priority"]
                    if update_fields:
                        try:
                            tb_put(f"/tickets/{tid}", update_fields)
                        except Exception:
                            pass
                    entry["bodyHash"] = remote_body_hash
                    any_change = True

                # Subtask hash change — sync subtasks
                remote_subtask_hash = parsed.get("subtaskHash", "")
                if remote_subtask_hash and entry.get("subtaskHash") != remote_subtask_hash:
                    try:
                        sync_subtasks_from_github(tid, parsed.get("subtasks", []))
                    except Exception:
                        pass
                    entry["subtaskHash"] = remote_subtask_hash
                    any_change = True

            if any_change:
                updated += 1
                print(f"  ~ {title} -> {local_status}")
            else:
                skipped += 1
        else:
            # --- Untracked item: try re-link by ULID, then import ---
            content_type = content.get("type", "") if content else ""
            # Accept Issues, DraftIssues, and items with no content type
            # Skip PRs and other content types we don't manage
            if content_type not in ("Issue", "DraftIssue", ""):
                skipped += 1
                continue

            # Team filter: only import items that belong to the allowed team
            # Items with v2 metadata carry a teamId — reject if it doesn't match
            # Items without metadata are also rejected (could be from another project)
            if allowed_team:
                item_team = parsed.get("teamId", "") if parsed else ""
                if item_team and item_team != allowed_team:
                    filtered += 1
                    continue
                # No metadata at all = unknown origin, skip to prevent cross-project import
                if not parsed:
                    filtered += 1
                    continue

            # Extract GitHub issue number from content if available
            gh_issue_num = content.get("number") if content else None

            # Check if metadata contains a ticketId we can re-link
            if parsed and parsed.get("ticketId"):
                meta_tid = parsed["ticketId"]
                # Verify this ticket exists locally
                local_ticket = tb_get(f"/tickets/{meta_tid}")
                if local_ticket and meta_tid not in tmap:
                    # Re-link without creating duplicate
                    entry_data = {
                        "githubItemId": item_id,
                        "lastLocalStatus": local_ticket.get("status", "todo"),
                        "lastGithubStatus": gh_status,
                        "title": title,
                        "number": local_ticket.get("number", 0),
                        "bodyHash": parsed.get("bodyHash", ""),
                        "subtaskHash": parsed.get("subtaskHash", ""),
                        "metadataVersion": parsed.get("version", 2),
                    }
                    if gh_issue_num:
                        entry_data["githubIssueNumber"] = gh_issue_num
                    tmap[meta_tid] = entry_data
                    # Sync status if different
                    if local_ticket.get("status") != local_status:
                        try:
                            tb_post(f"/tickets/{meta_tid}/move", {"status": local_status})
                            tmap[meta_tid]["lastLocalStatus"] = local_status
                        except Exception:
                            pass
                    relinked += 1
                    print(f"  * Re-linked {title} by ULID")
                    continue

            # Strip "PF-XX: " prefix if present
            clean_title = title
            if title.startswith("PF-") and ": " in title:
                clean_title = title.split(": ", 1)[1]

            # Extract priority and description from parsed body if available
            priority = "medium"
            description = body
            team_id = None
            if parsed:
                if parsed.get("priority"):
                    priority = parsed["priority"]
                if parsed.get("description"):
                    description = parsed["description"]
                if parsed.get("teamId"):
                    team_id = parsed["teamId"]

            try:
                create_data = {
                    "title": clean_title,
                    "description": description,
                    "priority": priority,
                    "projectId": project_id,
                }
                if team_id:
                    create_data["teamId"] = team_id

                new_ticket = tb_post("/tickets", create_data)

                new_tid = new_ticket.get("id", "")
                new_num = new_ticket.get("number", 0)
                if new_tid:
                    # Move to correct status if not todo
                    if local_status != "todo":
                        tb_post(f"/tickets/{new_tid}/move", {"status": local_status})

                    # Create subtasks if parsed from body
                    if parsed and parsed.get("subtasks"):
                        for st in parsed["subtasks"]:
                            try:
                                tb_post(f"/tickets/{new_tid}/subtasks", {
                                    "title": st.get("title", ""),
                                    "completed": st.get("completed", False),
                                })
                            except Exception:
                                pass

                    new_entry = {
                        "githubItemId": item_id,
                        "lastLocalStatus": local_status,
                        "lastGithubStatus": gh_status,
                        "title": title,
                        "number": new_num,
                        "bodyHash": parsed.get("bodyHash", "") if parsed else "",
                        "subtaskHash": parsed.get("subtaskHash", "") if parsed else "",
                        "metadataVersion": parsed.get("version", 1) if parsed else 1,
                    }
                    if gh_issue_num:
                        new_entry["githubIssueNumber"] = gh_issue_num
                    tmap[new_tid] = new_entry
                    created += 1
                    print(f"  + PF-{new_num}: {clean_title} [{local_status}]")
            except Exception as e:
                errors += 1
                print(f"  ! Create local failed {title}: {e}", file=sys.stderr)

    mapping["tickets"] = tmap
    save_map(mapping)

    if filtered:
        print(f"  [filter] {filtered} items skipped (wrong team / no metadata)")

    if created or updated or relinked or errors:
        parts = []
        if created:
            parts.append(f"{created} created locally")
        if updated:
            parts.append(f"{updated} updated locally")
        if relinked:
            parts.append(f"{relinked} re-linked")
        if errors:
            parts.append(f"{errors} errors")
        print(f"[SYNC<-GH] {', '.join(parts)}")


# ---------------------------------------------------------------------------
# STATUS: show sync state
# ---------------------------------------------------------------------------

def show_status():
    config = load_config()
    mapping = load_map()
    tmap = mapping.get("tickets", {})
    project_id = resolve_project_id(config)

    print(f"GitHub Project: {config['owner']}/{config['repo']} #{config['projectNumber']}")
    print(f"Last sync: {mapping.get('lastSync') or 'never'}")
    print(f"Tracked tickets: {len(tmap)}")

    tickets = tb_get(f"/tickets?project={project_id}")
    if tickets:
        tracked = sum(1 for t in tickets if t["id"] in tmap)
        untracked_active = sum(
            1 for t in tickets
            if t["id"] not in tmap and t.get("status") != "done"
        )
        print(f"Local tickets: {len(tickets)} total, {tracked} tracked, {untracked_active} untracked active")

        # Pending changes (local status differs from last-synced status)
        pending = []
        for t in tickets:
            tid = t["id"]
            if tid in tmap and tmap[tid].get("lastLocalStatus") != t.get("status"):
                num = t.get("number", "?")
                pending.append(
                    f"  PF-{num}: {tmap[tid]['lastLocalStatus']} -> {t['status']}"
                )

        if pending:
            print(f"\nPending outbound changes ({len(pending)}):")
            for p in pending:
                print(p)
        else:
            print("No pending outbound changes")
    else:
        print("Taskboard API unavailable")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def migrate_drafts():
    """Convert legacy draft items to real GitHub Issues.

    For each mapping entry that lacks a githubIssueNumber:
    1. Create a real GitHub Issue with the ticket body
    2. Add it to the project (gets a new PVTI_ item ID)
    3. Set the correct status
    4. Remove the old draft from the project
    5. Update the mapping with the new item ID and issue number
    """
    config = load_config()
    mapping = load_map()
    tmap = mapping.get("tickets", {})
    project_id = resolve_project_id(config)

    # Find entries missing githubIssueNumber
    legacy = {tid: e for tid, e in tmap.items() if not e.get("githubIssueNumber")}
    total = len(legacy)
    if total == 0:
        print("[MIGRATE] No legacy draft items to migrate.")
        return

    print(f"[MIGRATE] Found {total} legacy draft items to convert to real issues.")

    migrated = 0
    errors = 0
    skipped = 0

    for tid, entry in legacy.items():
        old_item_id = entry.get("githubItemId", "")
        title = entry.get("title", "Untitled")
        status = entry.get("lastLocalStatus", "todo")

        # Fetch full ticket for body
        full_ticket = tb_get(f"/tickets/{tid}")
        if not full_ticket:
            skipped += 1
            print(f"  - {title} (local ticket not found, skipping)")
            continue

        full_ticket["id"] = tid

        try:
            body = format_github_body(full_ticket)

            # Create real issue + add to project
            new_item_id, gh_issue_number = gh_create_issue_and_add_to_project(
                config, title, body
            )

            # Set status on the new project item
            gh_set_status(config, new_item_id, status)

            # Remove the old draft from the project
            if old_item_id:
                try:
                    gh_run([
                        "gh", "project", "item-delete",
                        str(config["projectNumber"]),
                        "--owner", config["owner"],
                        "--id", old_item_id,
                    ])
                except Exception:
                    pass  # draft removal is best-effort

            # Update mapping
            entry["githubItemId"] = new_item_id
            entry["githubIssueNumber"] = gh_issue_number
            entry["bodyHash"] = compute_body_hash(full_ticket)
            entry["subtaskHash"] = compute_subtask_hash(full_ticket.get("subtasks", []))
            entry["metadataVersion"] = 2

            migrated += 1
            print(f"  ✓ {title} -> Issue #{gh_issue_number}")
        except Exception as e:
            errors += 1
            print(f"  ! {title}: {e}", file=sys.stderr)

        # Save after each item in case of interruption
        if migrated % 5 == 0:
            mapping["tickets"] = tmap
            save_map(mapping)

    mapping["tickets"] = tmap
    save_map(mapping)

    print(f"[MIGRATE] Done: {migrated} migrated, {skipped} skipped, {errors} errors")


COMMANDS = {
    "push": lambda: push(include_done=False),
    "push-all": lambda: push(include_done=True),
    "pull": pull,
    "status": show_status,
    "migrate-drafts": migrate_drafts,
}

if __name__ == "__main__":
    if len(sys.argv) < 2 or sys.argv[1] not in COMMANDS:
        print(f"Usage: {sys.argv[0]} {{{' | '.join(COMMANDS)}}}")
        sys.exit(1)

    try:
        COMMANDS[sys.argv[1]]()
    except KeyboardInterrupt:
        sys.exit(130)
    except Exception as e:
        print(f"[SYNC ERROR] {e}", file=sys.stderr)
        sys.exit(1)
