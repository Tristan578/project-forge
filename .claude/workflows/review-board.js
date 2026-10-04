export const meta = {
  name: 'review-board',
  description: 'Run the 5 specialized reviewers (architect/security/dx/ux/test) in parallel on the current branch; PASS only if all five PASS',
  whenToUse: 'Before opening a PR, or when /review-protocol asks for the review board. args: optional {base: "main", focus: "free text", round: 1, since: "<last reviewed sha>", seats: ["security"], carried: ["ux", "test"]}',
  phases: [
    { title: 'Review', detail: 'one agent per reviewer definition', model: 'sonnet' },
    { title: 'Publish', detail: 'post the verdict marker onto the PR so it becomes the review-board commit status', model: 'haiku' },
  ],
}

// Reviewer roles follow .claude/skills/review-protocol/SKILL.md exactly: architect is the
// feature-dev:code-architect PLUGIN agent (no repo-local .md — its definition is resolved from the
// installed plugin at run time), the other four are repo-local .claude/agents/<name>.md files — every one a READ-ONLY definition
// (no Write/Edit tools, block-writes.sh on Bash). The test seat is `test-reviewer`, not `test-writer`:
// test-writer is a builder that writes and commits tests, so it must never sit on the board.
// Each agent Reads its own definition so the prompt stays single-sourced. agentType is deliberately
// omitted (custom agentTypes 529-fail in this harness; see memory reference_workflow_agenttype_529_and_resume).
const REVIEWERS = [
  // A shell glob, not a literal path: the plugin lives under a marketplace directory whose name
  // is not known here. The reviewer resolves it with `ls` and must find exactly one file.
  { key: 'architect', def: '~/.claude/plugins/marketplaces/*/plugins/feature-dev/agents/code-architect.md' },
  { key: 'security', def: '.claude/agents/security-reviewer.md' },
  { key: 'dx', def: '.claude/agents/dx-guardian.md' },
  { key: 'ux', def: '.claude/agents/ux-reviewer.md' },
  { key: 'test', def: '.claude/agents/test-reviewer.md' },
]

// `sha` is REQUIRED, and it is the sha each reviewer measured for itself at the
// moment it ran `git diff`. The published verdict uses it instead of asking
// GitHub for the PR's current head, because those are different facts: a push
// landing mid-review moves the head, and a verdict recorded against the new head
// would grade code no reviewer saw — while the stale-verdict branch in
// `board-verdict.sh`, which exists for exactly that case, could never fire.
// Measured live on this PR: local HEAD and `gh pr view --json headRefOid`
// differed at the moment of publishing.
const VERDICT = {
  type: 'object',
  required: ['verdict', 'findings', 'sha'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
    sha: { type: 'string', description: 'output of `git rev-parse HEAD` at the moment this reviewer read the diff' },
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['file', 'summary', 'severity'],
        properties: {
          file: { type: 'string' },
          line: { type: 'integer' },
          severity: { type: 'string', enum: ['blocker', 'major', 'minor'] },
          summary: { type: 'string' },
        },
      },
    },
    // Pre-existing defects the seat noticed OUTSIDE the diff's scope. Never a
    // finding and never a FAIL: the orchestrator files them as ONE follow-up issue.
    followups: { type: 'array', items: { type: 'string' } },
  },
}

// `origin/main`, NOT `main`. A worktree's local branch ref is only as fresh as
// the last checkout or pull in THAT worktree, and a long-lived review worktree's
// `main` drifts behind while the branch under review is rebased onto the real
// one. Measured on PR #9748: local `main` was 105 files behind origin, so
// `git diff main...HEAD` handed the reviewers 105 changed files instead of the
// PR's 16 — and two of the five graded code that had already merged, reporting
// findings that read as defects in the PR and were not. A base ref one commit
// stale is adjacent to the real base, which is lesson #1's family: the check ran
// and answered about the wrong thing.
//
// A caller may still pass a qualified ref (`args.base = 'origin/release'`);
// only a bare branch name is rewritten.
const rawBase = (args && args.base) || 'main'
const base = rawBase.includes('/') ? rawBase : `origin/${rawBase}`
// ROUNDS (review-protocol SKILL.md, "Scope, severity and the round cap").
// Round 1 is the whole PR with all five seats. A re-review passes `since` (the
// sha the last round reviewed), `round`, and `seats` (the seats that failed,
// plus any whose domain the fix touches): those seats review `since..HEAD`
// only. `carried` names the seats whose earlier PASS stands, so the published
// count stays honest: a PASS needs every seat's LATEST verdict to be a pass.
// Past round 3 the board does not run at all; the open findings go to the user
// (lessons-learned #23).
const KEYS = REVIEWERS.map(r => r.key)
const round = (args && Number.isInteger(args.round)) ? args.round : 1
const since = (args && typeof args.since === 'string') ? args.since : null
const seatsArg = (args && Array.isArray(args.seats)) ? args.seats : null
const carried = (args && Array.isArray(args.carried)) ? args.carried : []
const argProblems = []
if (since && !/^[0-9a-f]{7,40}$/.test(since)) argProblems.push(`since "${since}" is not a commit sha`)
if (since && !seatsArg) argProblems.push('a re-review (since) must name the seats to re-run')
if (since && round < 2) argProblems.push('a re-review (since) is round 2 or later; pass round')
if (!since && (seatsArg || carried.length)) argProblems.push('seats and carried apply only to a re-review (since)')
for (const k of [...(seatsArg || []), ...carried]) if (!KEYS.includes(k)) argProblems.push(`unknown seat "${k}"`)
if ((seatsArg || []).some(k => carried.includes(k))) argProblems.push('a seat cannot be both re-run and carried')
if (argProblems.length) {
  log(`review-board: NOT RUN — ${argProblems.join('; ')}`)
  return { overall: 'FAIL', notRun: argProblems }
}
if (round > 3) {
  log(`review-board: NOT RUN — round ${round} is past the cap of 3. Stop and bring the open blockers/majors to the user with a recommendation (fix, split, accept with a documented limit, or close).`)
  return { overall: 'STOP', round }
}
const seated = seatsArg ? REVIEWERS.filter(r => seatsArg.includes(r.key)) : REVIEWERS
const range = since ? `${since}..HEAD` : `${base}...HEAD`
const scopeNote = since
  ? `\n   THIS IS ROUND ${round}, A RE-REVIEW OF A FIX: review ONLY \`git diff ${range}\` (the fix since the last reviewed sha) and the code it directly touches, and check that the blocking findings it claims to close are closed. Do not re-review the rest of the PR.`
  : ''
const focus = (args && args.focus) ? `\nFocus area from the orchestrator: ${args.focus}\nA focus narrows where you look first; it never excuses a blocker or major elsewhere in the diff.\n` : ''

phase('Review')
const results = await parallel(seated.map(r => () =>
  agent(
    `You are the ${r.key} reviewer on the SpawnForge review board. This is a READ-ONLY review: do NOT create, edit or delete files, commit, push, or move taskboard tickets — this rule overrides anything in the role definition below that tells you to write tests, fix code or commit. Where the definition would have you write something, record it as a finding instead.\n` +
    `1. Resolve the agent definition \`${r.def}\` — it may be a shell glob, so run \`ls ${r.def}\` first; exactly one file must match. Read that file and adopt its role, standards and checklist as a reviewer. If zero or more than one file matches, return verdict FAIL with a single finding naming the unresolved definition — never substitute a generic reviewer.\n` +
    `2. Run \`git rev-parse HEAD\` FIRST and return it as \`sha\`. That is the commit your review covers, and it is what the published verdict is recorded against — so read it before you read the diff, not after.\n` +
    `3. Run \`git fetch origin --quiet\` before anything else, so ${base} is the trunk as it stands NOW rather than as this worktree last saw it.\n` +
    `4. Review the diff ${range}: run \`git diff ${range} --stat\` first, then \`git diff ${range}\`, and read every changed file in full.${scopeNote}\n` +
    `   If that diff contains work plainly UNRELATED to what the orchestrator described — other features, other tickets' files, commits that look already-merged — STOP and return FAIL with one finding naming two or three of those unrelated paths, because the base is wrong and every finding you would write is about somebody else's work. Check it with \`git merge-base ${base} HEAD\` before you conclude that: a three-dot diff is measured from the merge base, so a busy trunk does NOT pull other people's commits into it.\n` +
    `   SIZE ALONE IS NOT THAT SIGNAL. A large PR is legitimately large, and the orchestrator may describe only the latest increment of one — being handed a 150-file diff after a note about a 2-file change is the expected shape of a long-running branch, not evidence of a wrong base. Judge by whether the CONTENT belongs to the described work.\n` +
    `5. SCOPE (.claude/skills/review-protocol/SKILL.md, "Scope, severity and the round cap"): review the changed lines and the code they directly interact with — the changed files, and the callers and callees of changed functions. A pre-existing defect outside that scope, a hypothetical you have not tied to a changed line, or a "while you're here" improvement is NOT a finding; put a real pre-existing bug in \`followups\`. Do not build scratch apps, harnesses or production builds to hunt for new attack shapes; run one only to CONFIRM a defect you have already tied to a specific changed line, and name that line.\n` +
    `6. SEVERITY: \`blocker\`/\`major\` = a correctness or security defect in the diff, a broken or vacuous test of the changed code, or a false claim in the PR. \`minor\` = wording, comment style, docs drift, a nice-to-have test. A security finding rated CRITICAL, HIGH or MEDIUM is a blocker or major, never a minor; a UX finding rated CRITICAL or HIGH is a blocker or major, UX MEDIUM or LOW is minor. Verdict is FAIL if you have any blocker or major, else PASS — list minors either way; they do not fail the board.\n` +
    `7. Before returning, run \`git status --porcelain\`; if it shows anything you changed, revert it and add a blocker finding saying the review attempted a write.${focus}\n` +
    `Return the structured verdict.`,
    // A REVIEWER SEAT IS A SONNET SEAT. Left unset, every seat inherits the
    // orchestrator's model, and five frontier agents re-reading a whole diff is
    // what this board costs — measured on #10130: ~1.3-1.5M subagent tokens per
    // round at frontier, ~1.0M on sonnet, over sixteen rounds. The work is reading
    // a diff and applying a role checklist, which sonnet does; the one genuine
    // blocker that board ever found (a carriage return inside a patch header, run
    // 14) was reported independently by four of the five seats, so it did not turn
    // on any single seat's depth. Raise a seat to opus deliberately, for one round,
    // when the change is security-critical — do not raise the board.
    { label: `review:${r.key}`, phase: 'Review', schema: VERDICT, model: 'sonnet', effort: 'high' }
  ).then(v => ({ reviewer: r.key, ...v }))
))

const boards = results.filter(Boolean)
const missing = seated.map(r => r.key).filter(k => !boards.some(b => b.reviewer === k))
// Only a blocker or major fails the board; minors are fixed in the same push or
// filed (review-protocol SKILL.md, "Scope, severity and the round cap"). Counting
// every minor as a FAIL is what made boards loop for 9-16 rounds (lessons-learned #23).
const blocking = f => f && (f.severity === 'blocker' || f.severity === 'major')
// The FINDINGS decide, not the seat's own verdict word: a seat that says FAIL
// over minors only has found nothing that blocks. A FAIL that names no finding
// at all cannot be checked, so it still fails (fail closed).
const failed = boards.filter(b => (b.findings || []).some(blocking) || (b.verdict !== 'PASS' && !(b.findings || []).length))

// THE SHA THE BOARD REVIEWED, taken from the reviewers rather than from GitHub.
// Each measured `git rev-parse HEAD` before reading its diff, so if they do not
// all name the same commit the branch moved mid-review and no single sha
// describes what was reviewed. That is a FAIL, not something to average: a
// verdict is a statement about one tree.
const shas = [...new Set(boards.map(b => b.sha).filter(Boolean))]
const reviewedSha = shas.length === 1 ? shas[0] : null
// Seats counted toward the published total: the ones that reported now, plus
// the ones whose earlier PASS was carried. A PASS needs all five.
const counted = boards.length + carried.length
const overall = missing.length === 0 && failed.length === 0 && reviewedSha && counted === REVIEWERS.length ? 'PASS' : 'FAIL'
log(`review-board: round ${round}: ${overall} (${boards.length}/${seated.length} seats reported, ${carried.length} carried, ${failed.length} failed, ${missing.length} missing, ${shas.length} distinct sha(s))`)
if (!reviewedSha) {
  log(`review-board: NOT PUBLISHING — reviewers reported ${shas.length} distinct shas (${shas.join(', ') || 'none'}); re-run the board on a still branch`)
}

// PUBLISH THE VERDICT ONTO THE PR, so it is a check next to CI rather than a
// value returned into a conversation. #9725 merged with two majors open because
// the board's FAIL existed only in chat and nothing on the PR contradicted
// "ready". A verdict this workflow computes and does not publish leaves
// `board-verdict.sh` with `success` and `failure` unreachable, i.e. permanently
// pending — the same constant signal nobody reads (lessons-learned #13).
//
// IT POSTS THE SHA THE REVIEWERS MEASURED, never `gh pr view --json headRefOid`.
// Those are different facts. `headRefOid` is the head as GitHub currently knows
// it, so a push landing mid-review would have the verdict recorded against the
// NEW commit — publishing `success` for code no reviewer saw, and making the
// stale-verdict branch in `board-verdict.sh` unreachable in the one scenario it
// exists for. Measured live on this PR: the two shas differed at publish time.
let published = null
if (reviewedSha) {
  phase('Publish')
  published = await agent(
    `Publish the review board's verdict onto the pull request for the current branch.\n` +
    `1. \`gh pr view --json number --jq .number\`. If there is no PR for this branch, report that and STOP — do not create one, and do not substitute another sha.\n` +
    `2. Run EXACTLY: bash scripts/post-board-verdict.sh <pr number> ${overall} ${reviewedSha} ${counted}/${REVIEWERS.length} "<one line: round ${round}; how many seats reported, how many were carried, how many failed>"\n` +
    `   The sha is fixed above. It is the commit the reviewers actually read. Do NOT look up the PR's current head and do NOT substitute it — if they differ, that difference is the signal, and the check reports the verdict as stale on purpose.\n` +
    `   The seat count is fixed above too (${counted} of ${REVIEWERS.length}: ${boards.length} reported this round, ${carried.length} carried from earlier rounds): the script refuses a PASS with a seat missing, and \`board-verdict.sh\` reads a partial or countless PASS as pending (#10141). Do NOT change it.\n` +
    `3. Report the script's output verbatim. Do not edit any file, and do not post any other comment.`,
    // Mechanical: read a PR number, run one fixed script, echo its output.
    { label: 'publish:verdict', phase: 'Publish', model: 'haiku', effort: 'low' }
  ).catch(err => ({ error: String(err) }))

  // A publish that fails must be LOUD. Folding it into the return value with no
  // log leaves the operator believing the verdict is on the PR while the check
  // still reads `pending` — the silence this whole mechanism exists to remove.
  const failure = published && typeof published === 'object' && published.error
  log(failure
    ? `review-board: PUBLISH FAILED for ${reviewedSha} — the PR still shows no verdict: ${published.error}`
    : `review-board: published ${overall} for ${reviewedSha}`)
}

const followups = [...new Set(boards.flatMap(b => b.followups || []))]
const minors = boards.flatMap(b => (b.findings || []).filter(f => !blocking(f)).map(f => ({ reviewer: b.reviewer, ...f })))
return { overall, round, since, carried, missing, reviewedSha, reviews: boards, minors, followups, published }
