# Phase 2A Spec Review Findings — All 4 Reviewers

## Verdicts
- Architect: FAIL (3 blockers, 3 serious, 3 minor)
- Security: PASS WITH ISSUES (1 blocker prereq, 3 high, 2 medium, 1 low)
- UX: FAIL (1 critical, 3 high, 2 medium, 1 low)
- DX: FAIL (7 blocking, 4 significant)

## Blockers That Must Be Resolved in v2

### B1: `decomposeIntoSystems()` is unspecified (Architect #4, DX #2)
The most important function has no prompt, output schema, or validation strategy. Must specify: LLM prompt template, Zod output schema for GameSystem[], validation/retry for malformed responses, how the AI knows the system taxonomy.

### B2: Step ordering is broken — physics before entities (Architect #3, #6)
`applyPhysicsProfile()` needs `entityIds[]` but plan orders system steps before entity steps. Priority-sort doesn't handle cross-system dependencies. Need topological sort with explicit `dependsOn`.

### B3: "Feel" is missing from system decomposition (UX #1)
Systems capture functional requirements but lose emotional/experiential expectations. "Cozy farming sim" decomposes correctly but feels wrong. Need a `feel_directive` or `reference_games` field that informs system config values.

### B4: `auto_polish` calls telemetry functions on a game with no play data (Architect #1)
`diagnoseIssues()` requires `GameMetrics` (avgPlayTime, completionRate) that don't exist on a fresh build. Must use structural heuristics instead.

### B5: `character_setup` maps to 2D-only commands (Architect #2)
`rigToCommands()` emits `set_skeleton_2d`. Must detect project type (2D vs 3D) and route accordingly.

### B6: `custom_script_generate` is underspecified (Architect #5, DX #6, Security #1)
No entity binding (`update_script` needs entityId). No prompt template. No output validation. No test strategy (LLM output is non-deterministic). Sandbox escape via Reflect/Proxy not yet patched.

### B7: File count exceeds 15-file cap (DX #1, Architect #7)
Actual count is 17-21 depending on counting method. Must either reduce scope or revise the cap.

### B8: GDD type collision during migration (DX #11, Architect #8)
New `GameDesignDocument` interface conflicts with existing one in `gddGenerator.ts`. Must specify migration strategy.

### B9: System-to-executor string coupling has no type safety (DX #4)
`makeStep('physics_profile', ...)` uses untyped strings. No compile-time check that executor exists.

### B10: `genreAgnosticism.test.ts` is broken (DX #5)
Fixture filenames contain genre words. Synonyms not caught. False positives on comments. Not a security control.

## Security Fixes Required in v2

### S1: Config spread order allows override (Security #4)
`{ profile: 'platformer', ...system.config }` lets config override profile. Reverse order or validate keys.

### S2: Asset manifest has no tier cap enforcement (Security #3)
`planBuilder.ts` must truncate `assetManifest` to tier cap BEFORE generating steps. `generatePlan()` needs `userTier` parameter.

### S3: GDD fields unsanitized before second-stage LLM calls (Security #1)
`sanitizePrompt()` must be called on every GDD-derived string before interpolation into LLM prompts.

### S4: `styleDirective` unsanitized (Security #2)
New field with no validation before reaching generation APIs.

### S5: Fallback string format unvalidated (Security #6)
Need Zod schema: `z.string().regex(/^(primitive|builtin):[a-z][a-z0-9_-]{0,63}$/)`

### S6: Reflect/Proxy must be shadowed (Security prereq)
BLOCKER prerequisite before `custom_script_generate` can exist.

## UX Issues for v2

### U1: Users think in genres — system taxonomy is jargon (UX #2)
System categories must never be exposed to users. Approval gates show user-friendly descriptions, not system names.

### U2: Custom script fallback = quality cliff (UX #3)
Most creative ideas get worst implementation. Need confidence indicators and warnings.

### U3: Approval gates unspecified (UX #4)
Data model built now constrains future UI. Must define what info each gate provides.

### U4: Error messages are developer-facing (UX #5)
Each executor needs `userFacingErrorMessage`.

### U5: Token cost estimate unspecified (UX #7)
No accuracy, variance, tier-aware messaging, or fallback billing defined.

## DX Issues for v2

### D1: 5 fixtures inadequate (DX #9)
Need: zero-movement game, single-system game, 20+ system game, vague prompt, contradictory prompt, 2D game, adversarial prompt. Minimum 10-12.

### D2: No error consolidation strategy (DX #10)
Each executor handles errors independently. Need middleware or base class.

### D3: Cross-module dependency graph fragile (DX #8)
6+ imports from `game-creation/` to `ai/`. API changes break silently.

### D4: `estimatedScope` has new value 'tiny' (DX #7)
Breaks existing validators. Must update or remove.
