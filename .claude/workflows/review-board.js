export const meta = {
  name: 'review-board',
  description: 'Run the 5 specialized reviewers (architect/security/dx/ux/test) in parallel on the current branch; PASS only if all five PASS',
  whenToUse: 'Before opening a PR, or when /review-protocol asks for the review board. args: optional {base: "main", focus: "free text"}',
  phases: [{ title: 'Review', detail: 'one agent per reviewer definition' }],
}

// Reviewer definitions live in .claude/agents/<name>.md — each agent Reads its own
// definition so the prompt stays single-sourced. agentType is deliberately omitted
// (custom agentTypes 529-fail in this harness; see memory reference_workflow_agenttype_529_and_resume).
const REVIEWERS = [
  { key: 'architect', file: 'code-reviewer' },
  { key: 'security', file: 'security-reviewer' },
  { key: 'dx', file: 'dx-guardian' },
  { key: 'ux', file: 'ux-reviewer' },
  { key: 'test', file: 'validator' },
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
    `You are the ${r.key} reviewer on the SpawnForge review board.\n` +
    `1. Read .claude/agents/${r.file}.md and adopt that role, rules and checklist exactly.\n` +
    `2. Review the diff of the current branch against ${base}: run \`git diff ${base}...HEAD\` and read every changed file in full.\n` +
    `3. Verdict is PASS or FAIL only — ANY finding at ANY severity is a FAIL (no "pass with issues").\n` +
    `4. Do NOT edit files, commit, push, or move taskboard tickets.${focus}\n` +
    `Return the structured verdict.`,
    { label: `review:${r.key}`, phase: 'Review', schema: VERDICT }
  ).then(v => ({ reviewer: r.key, ...v }))
))

const boards = results.filter(Boolean)
const missing = REVIEWERS.map(r => r.key).filter(k => !boards.some(b => b.reviewer === k))
const failed = boards.filter(b => b.verdict !== 'PASS' || (b.findings && b.findings.length > 0))
const overall = missing.length === 0 && failed.length === 0 ? 'PASS' : 'FAIL'
log(`review-board: ${overall} (${boards.length}/${REVIEWERS.length} reported, ${failed.length} failed, ${missing.length} missing)`)
return { overall, missing, reviews: boards }
