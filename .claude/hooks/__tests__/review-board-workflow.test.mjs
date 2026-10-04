// Behaviour of .claude/workflows/review-board.js (#10325): the round cap, the
// fix-diff re-review with only the named seats, carried seats in the published
// count, and a board decided by blocking FINDINGS rather than a seat's verdict
// word. The workflow body runs as-is with its globals (agent, parallel, phase,
// log, args) stubbed; no model is called.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const file = fileURLToPath(new URL('../../workflows/review-board.js', import.meta.url))
const src = readFileSync(file, 'utf8')
assert.equal((src.match(/^export const meta = /gm) || []).length, 1, 'review-board.js must open with exactly one `export const meta =`')
const body = src.replace(/^export const meta = /m, 'const meta = ')
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
const run = new AsyncFunction('args', 'agent', 'parallel', 'phase', 'log', body)

const SHA = 'a'.repeat(40)
const SINCE = 'b'.repeat(40)
async function board(args, verdicts) {
  const prompts = {}
  let published = null
  const agent = async (prompt, opts) => {
    if (opts.label === 'publish:verdict') { published = prompt; return 'ok' }
    const key = opts.label.replace('review:', '')
    prompts[key] = prompt
    return { sha: SHA, ...(verdicts[key] || { verdict: 'PASS', findings: [] }) }
  }
  const parallel = fns => Promise.all(fns.map(f => f()))
  const out = await run(args, agent, parallel, () => {}, () => {})
  return { out, prompts, published }
}
const ALL_BUT_SECURITY = ['architect', 'dx', 'ux', 'test']

test('round 1 seats all five on the whole PR and publishes PASS 5/5', async () => {
  const r = await board({}, {})
  assert.equal(r.out.overall, 'PASS')
  assert.deepEqual(Object.keys(r.prompts).sort(), ['architect', 'dx', 'security', 'test', 'ux'])
  assert.match(r.prompts.security, /git diff origin\/main\.\.\.HEAD/)
  assert.match(r.published, /PASS a{40} 5\/5/)
})

test('a seat saying FAIL over minors only does not fail the board', async () => {
  const r = await board({}, { dx: { verdict: 'FAIL', findings: [{ file: 'a', summary: 'wording', severity: 'minor' }] } })
  assert.equal(r.out.overall, 'PASS')
})

test('a FAIL that names no finding still fails (fail closed)', async () => {
  const r = await board({}, { dx: { verdict: 'FAIL', findings: [] } })
  assert.equal(r.out.overall, 'FAIL')
})

test('a major fails the board even under a PASS verdict word', async () => {
  const r = await board({}, { test: { verdict: 'PASS', findings: [{ file: 'a', summary: 'x', severity: 'major' }] } })
  assert.equal(r.out.overall, 'FAIL')
})

test('a re-review runs only the named seats, on since..HEAD only', async () => {
  const r = await board({ round: 2, since: SINCE, seats: ['security'], carried: ALL_BUT_SECURITY }, {})
  assert.deepEqual(Object.keys(r.prompts), ['security'])
  assert.match(r.prompts.security, /git diff b{40}\.\.HEAD/)
  assert.match(r.prompts.security, /RE-REVIEW OF A FIX/)
  assert.doesNotMatch(r.prompts.security, /origin\/main\.\.\.HEAD/)
})

test('carried seats complete the count, so a re-review can publish PASS 5/5', async () => {
  const r = await board({ round: 2, since: SINCE, seats: ['security'], carried: ALL_BUT_SECURITY }, {})
  assert.equal(r.out.overall, 'PASS')
  assert.match(r.published, /PASS a{40} 5\/5/)
})

test('a re-review with seats unaccounted for cannot publish a PASS', async () => {
  const r = await board({ round: 2, since: SINCE, seats: ['security'] }, {})
  assert.equal(r.out.overall, 'FAIL')
  assert.match(r.published, /FAIL a{40} 1\/5/)
})

test('round 3 still runs; round 4 does not run and returns STOP', async () => {
  const r3 = await board({ round: 3, since: SINCE, seats: ['security'], carried: ALL_BUT_SECURITY }, {})
  assert.equal(r3.out.overall, 'PASS')
  const r4 = await board({ round: 4, since: SINCE, seats: ['security'] }, {})
  assert.equal(r4.out.overall, 'STOP')
  assert.deepEqual(Object.keys(r4.prompts), [])
  assert.equal(r4.published, null)
})

for (const [name, args] of [
  ['since without seats', { round: 2, since: SINCE }],
  ['since at round 1', { round: 1, since: SINCE, seats: ['dx'] }],
  ['since that is not a sha', { round: 2, since: 'HEAD~1', seats: ['dx'] }],
  ['an unknown seat', { round: 2, since: SINCE, seats: ['qa'] }],
  ['a seat both re-run and carried', { round: 2, since: SINCE, seats: ['dx'], carried: ['dx'] }],
  ['seats without since', { seats: ['dx'] }],
]) {
  test(`bad args (${name}): nothing runs, nothing is published`, async () => {
    const r = await board(args, {})
    assert.equal(r.out.overall, 'FAIL')
    assert.ok(Array.isArray(r.out.notRun) && r.out.notRun.length > 0)
    assert.deepEqual(Object.keys(r.prompts), [])
    assert.equal(r.published, null)
  })
}
