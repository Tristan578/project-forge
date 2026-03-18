# Spec & Plan Standards

Every spec or plan document in SpawnForge must include these sections. This prevents the four systemic gaps found during the 2026-03-16 documentation review.

## Required Sections

### 1. User Story & Product Context
- **Who** benefits (persona: beginner, indie dev, professional, educator)
- **Why** it matters (retention, acquisition, revenue, competitive positioning)
- **Tier** unlock strategy (starter vs pro vs all tiers)
- **Acceptance Criteria** in Given/When/Then format

### 2. Error Handling & Edge Cases
- Error types and user-visible messages
- Fallback behavior for each failure mode
- Recovery strategy (retry, degrade, abort)
- Timeout handling with user feedback

### 3. Performance & Scalability
- Latency targets (e.g., "<100ms for paint operation")
- Throughput targets (e.g., "50+ skinned sprites at 60fps")
- Test cases for performance validation
- Degradation strategy when limits exceeded

### 4. Integration Context
- How this feature connects to existing systems
- Which other features depend on or benefit from this
- Migration path from current state
- Backward compatibility requirements

## Anti-Patterns to Avoid
- Technical specs without user workflow narrative
- Happy-path-only design (no error handling section)
- Performance claims without measurement targets
- Duplicated information across multiple docs (link instead)

## Document Hierarchy
```
specs/           <- Product specifications (what + why)
docs/plans/      <- Technical designs (how)
docs/features/   <- User-facing documentation
docs/operations/ <- Operational runbooks
docs/reference/  <- API and architecture reference
```
