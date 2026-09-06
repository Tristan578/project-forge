export const meta = {
  name: 'review-board',
  description: 'Run the 5 specialized reviewers (architect/security/dx/ux/test) in parallel on the current branch; PASS only if all five PASS',
  whenToUse: 'Before opening a PR, or when /review-protocol asks for the review board. args: optional {base: "main", focus: "free text"}',
  phases: [
    { title: 'Review', detail: 'one agent per reviewer definition' },
    { title: 'Publish', detail: 'post the verdict marker onto the PR so it becomes the review-board commit status' },
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

const VERDICT = {
  type: 'object',
  required: ['verdict', 'findings'],
  properties: {
    verdict: { type: 'string', enum: ['PASS', 'FAIL'] },
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
  },
}

const base = (args && args.base) || 'main'
const focus = (args && args.focus) ? `\nFocus area from the orchestrator: ${args.focus}\n` : ''

phase('Review')
const results = await parallel(REVIEWERS.map(r => () =>
  agent(
    `You are the ${r.key} reviewer on the SpawnForge review board. This is a READ-ONLY review: do NOT create, edit or delete files, commit, push, or move taskboard tickets — this rule overrides anything in the role definition below that tells you to write tests, fix code or commit. Where the definition would have you write something, record it as a finding instead.\n` +
    `1. Resolve the agent definition \`${r.def}\` — it may be a shell glob, so run \`ls ${r.def}\` first; exactly one file must match. Read that file and adopt its role, standards and checklist as a reviewer. If zero or more than one file matches, return verdict FAIL with a single finding naming the unresolved definition — never substitute a generic reviewer.\n` +
    `2. Review the diff of the current branch against ${base}: run \`git diff ${base}...HEAD\` and read every changed file in full.\n` +
    `3. Verdict is PASS or FAIL only — ANY finding at ANY severity is a FAIL (no "pass with issues").\n` +
    `4. Before returning, run \`git status --porcelain\`; if it shows anything you changed, revert it and add a finding saying the review attempted a write.${focus}\n` +
    `Return the structured verdict.`,
    { label: `review:${r.key}`, phase: 'Review', schema: VERDICT }
  ).then(v => ({ reviewer: r.key, ...v }))
))

const boards = results.filter(Boolean)
const missing = REVIEWERS.map(r => r.key).filter(k => !boards.some(b => b.reviewer === k))
const failed = boards.filter(b => b.verdict !== 'PASS' || (b.findings && b.findings.length > 0))
const overall = missing.length === 0 && failed.length === 0 ? 'PASS' : 'FAIL'
log(`review-board: ${overall} (${boards.length}/${REVIEWERS.length} reported, ${failed.length} failed, ${missing.length} missing)`)

// PUBLISH THE VERDICT ONTO THE PR, so it is a check next to CI rather than a
// value returned into a conversation. #9725 merged with two majors open because
// the board's FAIL existed only in chat and nothing on the PR contradicted
// "ready". A verdict this workflow computes and does not publish leaves
// `board-verdict.sh` with `success` and `failure` unreachable, i.e. permanently
// pending — the same constant signal nobody reads (lessons-learned #13).
//
// It posts the sha the board ACTUALLY REVIEWED, read at publish time from the
// same branch the reviewers diffed. If a push landed mid-review, that sha is no
// longer the head, and `board-verdict.sh` reports the verdict as stale rather
// than letting it grade code no reviewer saw.
phase('Publish')
const published = await agent(
  `Publish the review board's verdict onto the pull request for the current branch.\n` +
  `1. \`gh pr view --json number,headRefOid --jq '[.number, .headRefOid] | @tsv'\`. If there is no PR for this branch, stop and report that — do not create one.\n` +
  `2. Run: bash scripts/post-board-verdict.sh <pr number> ${overall} <the head sha from step 1> "<one line: how many reviewers reported and how many failed>"\n` +
  `3. Report the script's output verbatim. Do not edit any file, and do not post any other comment.`,
  { label: 'publish:verdict', phase: 'Publish' }
).catch(err => ({ error: String(err) }))

return { overall, missing, reviews: boards, published }
