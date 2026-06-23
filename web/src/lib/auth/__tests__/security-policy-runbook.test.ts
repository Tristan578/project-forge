/**
 * Doc/policy sync guard (PF-910, #8820).
 *
 * The Dashboard-only Clerk protections the app expects are declared in code
 * (`EXPECTED_CLERK_PROTECTIONS`) AND documented in the operator runbook. This
 * test pins that the runbook lists every expected protection's id and its
 * Dashboard path, so a future change to one can't silently desync from the
 * other. CI-verifiable: it reads the actual committed markdown.
 *
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { EXPECTED_CLERK_PROTECTIONS, STEP_UP_ROUTES } from '../security-policy';

// vitest runs with cwd = web/. The runbook lives at repo-root docs/.
const RUNBOOK_PATH = join(process.cwd(), '..', 'docs', 'security', 'clerk-account-protection.md');

function readRunbook(): string {
  return readFileSync(RUNBOOK_PATH, 'utf8');
}

describe('Clerk account-protection runbook stays in sync with policy code', () => {
  it('documents the Dashboard path for every expected protection', () => {
    const doc = readRunbook();
    for (const protection of EXPECTED_CLERK_PROTECTIONS) {
      expect(doc, `runbook missing dashboardPath for ${protection.id}`).toContain(
        protection.dashboardPath,
      );
    }
  });

  it('documents every step-up route path', () => {
    const doc = readRunbook();
    for (const [id, entry] of Object.entries(STEP_UP_ROUTES)) {
      expect(doc, `runbook missing route ${id} (${entry.path})`).toContain(entry.path);
    }
  });
});
