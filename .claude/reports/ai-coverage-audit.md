# AI Module Coverage Audit

**Date:** 2026-03-21
**Ticket:** PF-677
**Auditor:** Builder agent (af26ddbf)

---

## Summary

All 37 source files in `web/src/lib/ai/` have corresponding test files in
`web/src/lib/ai/__tests__/`. The directory-scoped coverage run (37 test files,
~1,450 test cases) reported the following aggregate metrics:

| Metric     | Result | Threshold (90%) | Status |
|------------|--------|-----------------|--------|
| Statements | 94.04% | 90%             | PASS   |
| Branches   | 84.18% | 90%             | FAIL   |
| Functions  | 98.52% | 90%             | PASS   |
| Lines      | 96.21% | 90%             | PASS   |

**Overall: 3 of 4 metrics meet the 90% target.** Branch coverage at 84.18%
is the only metric below threshold.

---

## Test File Inventory

All source files have a corresponding test:

| Source file                | Test file                                   |
|---------------------------|---------------------------------------------|
| accessibilityGenerator.ts | __tests__/accessibilityGenerator.test.ts (47 tests) |
| artStyleEngine.ts         | __tests__/artStyleEngine.test.ts (67 tests) |
| autoIteration.ts          | __tests__/autoIteration.test.ts (42 tests)  |
| autoRigging.ts            | __tests__/autoRigging.test.ts (90 tests)    |
| behaviorTree.ts           | __tests__/behaviorTree.test.ts (73 tests)   |
| budgetManager.ts          | __tests__/budgetManager.test.ts (24 tests)  |
| cachedContext.ts          | __tests__/cachedContext.test.ts (17 tests)  |
| contentSafety.ts          | __tests__/contentSafety.test.ts (39 tests)  |
| costAnomaly.ts            | __tests__/costAnomaly.test.ts (21 tests)    |
| designTeacher.ts          | __tests__/designTeacher.test.ts (38 tests)  |
| difficultyAdjustment.ts   | __tests__/difficultyAdjustment.test.ts (34 tests) |
| economyDesigner.ts        | __tests__/economyDesigner.test.ts (44 tests)|
| effectSystem.ts           | __tests__/effectSystem.test.ts (47 tests)   |
| emotionalPacing.ts        | __tests__/emotionalPacing.test.ts (31 tests)|
| gameModifier.ts           | __tests__/gameModifier.test.ts (39 tests)   |
| gameplayBot.ts            | __tests__/gameplayBot.test.ts (42 tests)    |
| gameReviewer.ts           | __tests__/gameReviewer.test.ts (41 tests)   |
| gddGenerator.ts           | __tests__/gddGenerator.test.ts (55 tests)   |
| ideaGenerator.ts          | __tests__/ideaGenerator.test.ts (46 tests)  |
| levelGenerator.ts         | __tests__/levelGenerator.test.ts (72 tests) |
| models.ts                 | __tests__/models.test.ts (13 tests)         |
| narrativeGenerator.ts     | __tests__/narrativeGenerator.test.ts (48 tests) |
| physicsFeel.ts            | __tests__/physicsFeel.test.ts (42 tests)    |
| proceduralAnimation.ts    | __tests__/proceduralAnimation.test.ts (61 tests) |
| promptCache.ts            | __tests__/promptCache.test.ts (19 tests)    |
| providerHealth.ts         | __tests__/providerHealth.test.ts (26 tests) |
| questGenerator.ts         | __tests__/questGenerator.test.ts (45 tests) |
| saveSystemGenerator.ts    | __tests__/saveSystemGenerator.test.ts (35 tests) |
| sceneContext.ts           | __tests__/sceneContext.test.ts (19 tests)   |
| schemaValidator.ts        | __tests__/schemaValidator.test.ts (40 tests)|
| smartCamera.ts            | __tests__/smartCamera.test.ts (41 tests)    |
| streaming.ts              | __tests__/streaming.test.ts (28 tests)      |
| texturePainter.ts         | __tests__/texturePainter.test.ts (48 tests) |
| tierAccess.ts             | __tests__/tierAccess.test.ts (18 tests)     |
| tutorialGenerator.ts      | __tests__/tutorialGenerator.test.ts (31 tests) |
| worldBuilder.ts           | __tests__/worldBuilder.test.ts (79 tests)   |
| (parity check)            | __tests__/checkCommandParityRegex.test.ts (16 tests) |

---

## Branch Coverage Gap (84.18%)

Branch coverage is below 90%. The gap stems from defensive error paths and
optional-chaining branches that are difficult to trigger without real API
responses. Priority areas to improve:

1. **Error-path branches** — `try/catch` blocks where the catch is never
   triggered in tests (streaming errors, malformed responses)
2. **Optional fields** — `?.` chains on AI response objects where the
   undefined branch is never exercised
3. **Tier-gating branches** — `if (!tierAccess.canUse(...))` paths that
   require mocking specific tier configurations

### Recommended next steps

- Add negative-path tests to `streaming.test.ts`: simulate truncated SSE,
  malformed JSON, and aborted fetch
- Add tests to `tierAccess.test.ts` for all 4 tiers (starter, hobbyist,
  creator, pro) against each feature gate
- Add `null` response tests to generator modules (gddGenerator,
  levelGenerator, narrativeGenerator) that simulate the AI returning
  empty or incomplete output

These additions are estimated to close the branch gap to above 90%.

---

## Conclusion

The `src/lib/ai/` module is well-tested. No uncovered files exist. The
single gap (branch coverage 84.18%) is addressable with targeted negative-path
and tier-gate tests. No new test file stubs are required — existing test files
should be extended.
