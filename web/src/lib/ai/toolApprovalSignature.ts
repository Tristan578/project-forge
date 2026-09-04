/**
 * Verify the HMAC the AI SDK stamps on every approval request it issues.
 *
 * WHY THIS EXISTS AT ALL — the SDK's own check does not run on our resume.
 *
 * `ToolLoopAgent({ experimental_toolApprovalSecret })` signs each
 * `tool-approval-request` and, on resume, `validateApprovedToolApprovals`
 * re-derives the HMAC over (approvalId, toolCallId, toolName, input) and
 * throws `InvalidToolApprovalSignatureError` on a mismatch. That is exactly
 * the binding we want: the approval history is rebuilt in the BROWSER, so
 * without it nothing stops a compromised client from approving
 * `delete_entities({entityIds:['1']})` and resuming with ten more ids.
 *
 * But `collectToolApprovals` (ai@7.0.84, dist/index.js:2943) skips an approval
 * outright when a `tool-result` for the same toolCallId is already present:
 *
 *     if (existingToolResult != null &&
 *         (approvalResponse.approved || existingToolResult.output.type !== "execution-denied"))
 *       continue;
 *
 * Our tools carry no server-side `execute` — the client runs them against the
 * WASM engine — so an approved resume ALWAYS ships its own `tool-result`
 * (`chatStore.appendToolTurn`), or the assistant `tool_use` would reach the
 * provider unanswered and 400. Every approved approval we send therefore hits
 * that `continue` and is never validated. Measured, not assumed: with the
 * result attached, both a widened input and a wholly forged approvalId stream
 * back zero errors.
 *
 * So the signature is verified HERE, in the route, before the messages reach
 * `agent.stream()`. The secret stays set on the agent as well: it is what
 * MINTS the signature, and it still covers the shapes the SDK does check.
 *
 * The payload construction below mirrors ai@7's
 * `src/generate-text/tool-approval-signature.ts` byte for byte. Those helpers
 * are not exported, so this is a reimplementation and could drift on an SDK
 * upgrade — which is why `__tests__/toolApprovalSignature.test.ts` verifies a
 * signature minted by the REAL SDK rather than one this module signed itself.
 * Drift fails that test, and in production fails CLOSED (a valid approval is
 * rejected) rather than open.
 */

const encoder = new TextEncoder();

/** ai@7 `src/util/canonical-hash.ts` — key-sorted, `undefined` preserved. */
function canonicalJSON(value: unknown): string {
  if (value === null || value === undefined) {
    // `JSON.stringify(undefined)` is `undefined`, which the SDK then string-
    // interpolates into the surrounding entry. `String()` reproduces that.
    return String(JSON.stringify(value));
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJSON).join(',')}]`;
  }
  const record = value as Record<string, unknown>;
  const entries = Object.keys(record)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonicalJSON(record[k])}`);
  return `{${entries.join(',')}}`;
}

function toBase64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function fromBase64url(value: string): Uint8Array<ArrayBuffer> {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function hashCanonical(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(canonicalJSON(value)));
  return toBase64url(new Uint8Array(digest));
}

async function importKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export interface ToolApprovalSignatureInput {
  secret: string;
  signature: string;
  approvalId: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/**
 * True when `signature` is the SDK's HMAC over this exact (approvalId,
 * toolCallId, toolName, input). Never throws: a malformed base64 signature is
 * a failed verification, not a 500.
 */
export async function verifyToolApprovalSignature({
  secret,
  signature,
  approvalId,
  toolCallId,
  toolName,
  input,
}: ToolApprovalSignatureInput): Promise<boolean> {
  try {
    const key = await importKey(secret);
    const inputDigest = await hashCanonical(input);
    const sigBytes = fromBase64url(signature);
    const payload = encoder.encode(
      JSON.stringify(['ai-sdk-tool-approval-v1', approvalId, toolCallId, toolName, inputDigest]),
    );
    if (await crypto.subtle.verify('HMAC', key, sigBytes, payload)) return true;

    // The SDK still accepts its own pre-v1 newline-joined payload, and so do
    // we: an approval issued seconds before a deploy must stay resumable.
    if (approvalId.includes('\n') || toolCallId.includes('\n') || toolName.includes('\n')) {
      return false;
    }
    const legacy = encoder.encode(`${approvalId}\n${toolCallId}\n${toolName}\n${inputDigest}`);
    return await crypto.subtle.verify('HMAC', key, sigBytes, legacy);
  } catch {
    return false;
  }
}

export type ApprovalVerificationReason =
  | 'unknown-approval'
  | 'missing-tool-call'
  | 'missing-signature'
  | 'invalid-signature';

export interface ApprovalVerificationFailure {
  approvalId: string;
  reason: ApprovalVerificationReason;
}

/** The message shape this module walks — a structural subset of ModelMessage. */
type MessageLike = { role: string; content: unknown };

interface CollectedApprovals {
  /** approvalId → the request the assistant turn carried. */
  requests: Map<string, { toolCallId: string; signature?: string }>;
  /** toolCallId → the call the assistant turn carried. */
  calls: Map<string, { toolName: string; input: unknown }>;
  /** Every approval-response in the history, in order. */
  responses: Array<{ approvalId: string; approved: boolean }>;
}

function collect(messages: MessageLike[]): CollectedApprovals {
  const requests = new Map<string, { toolCallId: string; signature?: string }>();
  const calls = new Map<string, { toolName: string; input: unknown }>();
  const responses: Array<{ approvalId: string; approved: boolean }> = [];

  for (const message of messages) {
    if (!Array.isArray(message.content)) continue;
    for (const raw of message.content) {
      if (typeof raw !== 'object' || raw === null) continue;
      const part = raw as Record<string, unknown>;
      if (part.type === 'tool-call' && typeof part.toolCallId === 'string' && typeof part.toolName === 'string') {
        calls.set(part.toolCallId, { toolName: part.toolName, input: part.input ?? {} });
      } else if (
        part.type === 'tool-approval-request' &&
        typeof part.approvalId === 'string' &&
        typeof part.toolCallId === 'string'
      ) {
        requests.set(part.approvalId, {
          toolCallId: part.toolCallId,
          signature: typeof part.signature === 'string' ? part.signature : undefined,
        });
      } else if (
        part.type === 'tool-approval-response' &&
        typeof part.approvalId === 'string' &&
        typeof part.approved === 'boolean'
      ) {
        responses.push({ approvalId: part.approvalId, approved: part.approved });
      }
    }
  }

  return { requests, calls, responses };
}

async function verifyOne(
  approvalId: string,
  collected: CollectedApprovals,
  secret: string,
): Promise<ApprovalVerificationFailure | null> {
  const request = collected.requests.get(approvalId);
  if (!request) return { approvalId, reason: 'unknown-approval' };

  const call = collected.calls.get(request.toolCallId);
  if (!call) return { approvalId, reason: 'missing-tool-call' };

  if (!request.signature) return { approvalId, reason: 'missing-signature' };

  const ok = await verifyToolApprovalSignature({
    secret,
    signature: request.signature,
    approvalId,
    toolCallId: request.toolCallId,
    toolName: call.toolName,
    input: call.input,
  });
  return ok ? null : { approvalId, reason: 'invalid-signature' };
}

/**
 * Verify every APPROVED approval-response in the history against the request
 * that authorized it and the tool-call it is answering.
 *
 * Returns the first failure, or `null` when everything checks out. Denials are
 * not verified here: refusing a denial gains nothing and would turn a client
 * that is trying to say "no" into an error. `deniedApprovalsAreAuthentic`
 * covers the one place a denial's authenticity matters (the refund).
 */
export async function verifyApprovedToolApprovals(
  messages: MessageLike[],
  secret: string,
): Promise<ApprovalVerificationFailure | null> {
  const collected = collect(messages);
  for (const response of collected.responses) {
    if (!response.approved) continue;
    const failure = await verifyOne(response.approvalId, collected, secret);
    if (failure) return failure;
  }
  return null;
}

/**
 * True when the history carries at least one approval-response, every one of
 * them is a DENIAL, and every one traces back to a correctly signed request we
 * issued.
 *
 * This gates the double-billing refund (`/api/chat`). The signature check is
 * what keeps it from being free chat: a client cannot mint denials for turns
 * that were never gated, so at most one refund exists per genuinely gated —
 * and therefore already paid for — turn.
 */
export async function deniedApprovalsAreAuthentic(
  messages: MessageLike[],
  secret: string,
): Promise<boolean> {
  const collected = collect(messages);
  if (collected.responses.length === 0) return false;
  if (collected.responses.some((r) => r.approved)) return false;

  for (const response of collected.responses) {
    if (await verifyOne(response.approvalId, collected, secret)) return false;
  }
  return true;
}
