import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../../workflows/review-board.js', import.meta.url), 'utf8')
const run = new Function('log', 'agent', src.replace(/^export const meta = /m, 'const meta = '))

test('legacy workflow blocks before dispatching any ambient agent', () => {
  const messages = []
  const result = run(message => messages.push(message), () => assert.fail('An ambient agent was dispatched'))
  assert.equal(result.overall, 'BLOCKED')
  assert.match(messages.join('\n'), /review_board\.py/)
})
