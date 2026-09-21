# PR Review Report

**PR:** #<!-- PR_NUMBER -->
**Reviewer Role:** <!-- architect | security | dx | ux | test -->
**Date:** <!-- YYYY-MM-DD -->

---

## Verdict

**<!-- PASS | FAIL -->**

<!-- One sentence summary of the verdict reasoning -->

---

## Findings

<!-- If PASS with no findings, write: "No findings. All checklist items passed." -->
<!-- If FAIL, list every finding. No finding may be omitted. -->

### Finding 1

| Field | Value |
|-------|-------|
| **Severity** | <!-- critical | high | medium | low --> |
| **File** | `<!-- path/to/file.ts -->` |
| **Line** | <!-- line number or range --> |
| **Rule** | <!-- anti-pattern name or rule ID --> |

**Description:**
<!-- Precise description of what is wrong. Be specific — include the exact code if helpful. -->

**Fix:**
<!-- Exact fix required. If ambiguous, describe the acceptable range of solutions. -->

---

### Finding 2

| Field | Value |
|-------|-------|
| **Severity** | <!-- critical | high | medium | low --> |
| **File** | `<!-- path/to/file.ts -->` |
| **Line** | <!-- line number or range --> |
| **Rule** | <!-- anti-pattern name or rule ID --> |

**Description:**
<!-- ... -->

**Fix:**
<!-- ... -->

---

<!-- Add additional findings as needed, numbered sequentially -->

---

## Checklist

<!-- Check each item you verified. Leave unchecked items if out of scope for your reviewer role. -->

### Architecture
- [ ] Bridge isolation
- [ ] Import boundaries
- [ ] DB transaction pattern
- [ ] Manifest sync
- [ ] Component registration

### Security
- [ ] Rate limit await
- [ ] Input validation
- [ ] Auth on new routes
- [ ] No secrets in responses

### DX
- [ ] ESLint zero warnings
- [ ] TypeScript strict
- [ ] Error messages actionable

### UX / Frontend
- [ ] Color scale (zinc-*)
- [ ] Keyboard navigation
- [ ] ARIA labels
- [ ] Empty states

### Testing
- [ ] New functions have tests
- [ ] Bug fixes have regression tests
- [ ] vi.mock uses @/ aliases
- [ ] No skipped tests without ticket

---

## Summary

<!-- 2-4 sentences. For PASS: confirm the code is safe to merge and why. For FAIL: restate the blocking issues and what the author must do before re-review. -->
