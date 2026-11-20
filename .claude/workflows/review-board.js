export const meta = {
  name: 'review-board',
  description: 'Direct reviewers to the isolated SpawnForge review launcher',
  whenToUse: 'Before a PR or when the review protocol asks for the board',
}

// Workflow children otherwise inherit the host session's capabilities.
const instruction = 'Run python .claude/tools/review_board.py --base <verified-base-sha> from a trusted checkout.'
log(instruction)
return { overall: 'BLOCKED', instruction }
