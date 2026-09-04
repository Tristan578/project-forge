/**
 * Unit-level edge cases for the approval-signature verifier.
 *
 * The behaviour that matters against a REAL SDK-minted signature is pinned in
 * `toolApprovalResume.integration.test.ts` — a self-signed fixture here would
 * only prove this module agrees with itself. What this file covers is the
 * property that file cannot: hostile input must produce a REJECTION, never a
 * throw. A 500 on a malformed signature is a denial-of-service on the resume
 * path, and an unhandled rejection inside the route would skip the gate.
 */

import { describe, it, expect } from 'vitest';
import {
  verifyToolApprovalSignature,
  verifyApprovedToolApprovals,
  deniedApprovalsAreAuthentic,
} from '@/lib/ai/toolApprovalSignature';

const BASE = {
  secret: 'secret',
  approvalId: 'ap-1',
  toolCallId: 'tc-1',
  toolName: 'delete_entities',
  input: { entityIds: ['1'] },
};

describe('verifyToolApprovalSignature — hostile input', () => {
  it.each([
    ['empty', ''],
    ['not base64url', '!!!!not-base64!!!!'],
    ['truncated', 'AAAA'],
    ['enormous', 'A'.repeat(100_000)],
  ])('returns false for a %s signature rather than throwing', async (_label, signature) => {
    await expect(verifyToolApprovalSignature({ ...BASE, signature })).resolves.toBe(false);
  });

  it('returns false when the secret is empty', async () => {
    await expect(
      verifyToolApprovalSignature({ ...BASE, secret: '', signature: 'AAAA' }),
    ).resolves.toBe(false);
  });
});

describe('verifyApprovedToolApprovals — history shapes', () => {
  const approved = (parts: unknown[]) => [
    { role: 'assistant', content: parts },
    { role: 'tool', content: [{ type: 'tool-approval-response', approvalId: 'ap-1', approved: true }] },
  ];

  it('rejects an approval with no matching request in the history', async () => {
    await expect(verifyApprovedToolApprovals(approved([]), 'secret')).resolves.toEqual({
      approvalId: 'ap-1',
      reason: 'unknown-approval',
    });
  });

  it('rejects a request whose tool-call is absent', async () => {
    // Without the call there is nothing to bind the signature TO — the input
    // being authorized would be unknown.
    await expect(
      verifyApprovedToolApprovals(
        approved([
          { type: 'tool-approval-request', approvalId: 'ap-1', toolCallId: 'tc-1', signature: 'x' },
        ]),
        'secret',
      ),
    ).resolves.toEqual({ approvalId: 'ap-1', reason: 'missing-tool-call' });
  });

  it('passes a history with no approvals at all', async () => {
    // An ordinary turn must not be blocked by the approval verifier.
    await expect(
      verifyApprovedToolApprovals([{ role: 'user', content: 'hello' }], 'secret'),
    ).resolves.toBeNull();
  });

  it('ignores non-array and malformed content without throwing', async () => {
    await expect(
      verifyApprovedToolApprovals(
        [
          { role: 'user', content: 'plain string' },
          { role: 'assistant', content: [null, 42, { type: 'text', text: 'hi' }] },
        ],
        'secret',
      ),
    ).resolves.toBeNull();
  });

  it('does not verify DENIALS — a user saying no must never be an error', async () => {
    await expect(
      verifyApprovedToolApprovals(
        [
          {
            role: 'tool',
            content: [{ type: 'tool-approval-response', approvalId: 'ap-1', approved: false }],
          },
        ],
        'secret',
      ),
    ).resolves.toBeNull();
  });
});

describe('deniedApprovalsAreAuthentic', () => {
  it('is false when any response in the history is an approval', async () => {
    await expect(
      deniedApprovalsAreAuthentic(
        [
          {
            role: 'tool',
            content: [
              { type: 'tool-approval-response', approvalId: 'ap-1', approved: false },
              { type: 'tool-approval-response', approvalId: 'ap-2', approved: true },
            ],
          },
        ],
        'secret',
      ),
    ).resolves.toBe(false);
  });

  it('is false for an unsigned denial — otherwise the refund is free chat', async () => {
    await expect(
      deniedApprovalsAreAuthentic(
        [
          {
            role: 'tool',
            content: [{ type: 'tool-approval-response', approvalId: 'ap-1', approved: false }],
          },
        ],
        'secret',
      ),
    ).resolves.toBe(false);
  });
});
