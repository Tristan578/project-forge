# Skillist November 19 remediation

Local planning ticket SF-SKILLIST-01 · Engineering · high · in progress.
November 19 remediation plan R00–R03 and R09. The shared Taskboard did not
respond during source confirmation. This planning record is scoped to the
review branch and carries no shared-board status.

As a SpawnForge maintainer, I want reviewers to inspect a pinned project
revision and health checks to verify the requested release, so that reviews
cannot change the subject and incomplete work cannot look delivered.

1. Given a committed change, when a review starts, then every seat receives
   the pinned diff and its own role in an isolated tool-free session.
2. Given a missing, malformed, timed-out or unregistered hook, when the review
   starts, then the runtime still exposes no mutation path or connector.
3. Given stale, missing, degraded or wrong-environment evidence, when the
   health gate runs, then it reports the actual outcome and withholds Done.

Subtasks

1. Confirm current source and inspect runtime capabilities without values.
2. Enforce and test the review boundary on a synthetic, disposable project.
3. Bind health and completion to independent evidence and exercise both gates.

Rollback is a revert on the review branch. Keep the reviewer path suspended
if reverting restores ambient tool inheritance. Live enablement and the shared
ticket transition are separate from this revision.

## Source and entry points

- Authority is origin/main at `fe45076663d7b50fecf9860c9d949f0763554cb6`.
  The audited health entry matches that commit and the overlay manifest SHA-256
  `90513b36207d6989d234460e24e5a3d7de76b6f554dc8548a9d94b2632eb0a72`.
- Reviewer entry points are the review-protocol skill and its
  `.claude/tools/review_board.py` launcher. The previous workflow exits blocked
  before starting any agents. The launcher's prompt packet is produced from
  the committed Git tree and selected tracked callers.
- Health entry points are both skill copies' `scripts/run-health-check.sh`.
  The Claude source and Codex mirror are kept aligned by the project port.
  The health checker incorporates the overlay's release, environment and
  requirement binding and fetches evidence from GitHub and the project origin.

## Evidence and limits

- Windows Claude Code 2.1.252 and Codex 0.144.1 installed. The loopback model
  fixture observed only the structured output channel on every isolated seat
  and verified runtime rejection of uncovered Write, Bash, MCP create and
  network tools. The legacy workflow fixture asserts it dispatches zero agents.
- Native PreToolUse fixture: exit 2 denied a harmless read. Missing executable,
  malformed stdout, timeout and unmatched registration continued the read.
  Duplicate command registrations ran once. The isolation boundary has no
  reliance on that hook outcome. The original script remains supplemental.
- Value-free MCP inventory found eight project stdio entries in both SpawnForge
  project configurations, with prompt approval in the Codex configuration.
  The local Claude project also has a Taskboard entry. Taskboard source registers
  create, update, move and delete operations, so review excludes the server.
  Browser, shell and connector actions were absent in the fixture. The effective
  scopes of unrelated implementation and production services remain unverified.
- Read-only production check on November 19 Central paired GitHub deployment
  `7628165694` with CD run `42421900245`. Production reported the expected release
  prefix and the public landing and sign-in pages responded. AI Providers were
  degraded. The November 7 smoke run was outside the 24-hour window, so current
  customer behavior remained unknown and completion incomplete. No authenticated
  customer action or deployment change was performed.

## Reproduce

```bash
python -B .claude/tools/test_native_reviewer.py -v
python -B .claude/tools/test_release_health.py -v
node --test .claude/hooks/__tests__/review-board-workflow.test.mjs
node tools/agentic-sync/port.mjs --check
```

Fixtures prove the recorded behavior on the installed Windows runtime. Live
provider review, authenticated customer behavior, staging verification and
release approval remain open. The approved task completion inventory must cover
the real requirements and findings. Keep the shared ticket incomplete.
