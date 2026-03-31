#!/usr/bin/env npx ts-node
/**
 * sentry-to-test-stub.ts
 *
 * Takes a Sentry error (from stdin as JSON or from --issue-id arg via Sentry API)
 * and generates a Vitest test stub that reproduces the reported error.
 *
 * Usage:
 *   # From piped Sentry event JSON
 *   cat sentry-event.json | npx ts-node scripts/sentry-to-test-stub.ts
 *
 *   # From a Sentry API event ID (requires SENTRY_AUTH_TOKEN env var)
 *   npx ts-node scripts/sentry-to-test-stub.ts --issue-id ISSUE_ID
 *
 *   # Pass raw JSON inline
 *   npx ts-node scripts/sentry-to-test-stub.ts --json '{"title":"...","culprit":"...",...}'
 *
 * Output:
 *   Writes the test stub to stdout. Redirect to the appropriate test file.
 *
 * Example:
 *   npx ts-node scripts/sentry-to-test-stub.ts --issue-id abc123 \
 *     > web/src/lib/tokens/__tests__/creditManager.sentry.test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SentryFrame {
  filename?: string;
  module?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  context_line?: string;
  pre_context?: string[];
  post_context?: string[];
  abs_path?: string;
  in_app?: boolean;
}

interface SentryException {
  type?: string;
  value?: string;
  stacktrace?: {
    frames?: SentryFrame[];
  };
}

interface SentryEvent {
  id?: string;
  title?: string;
  culprit?: string;
  message?: string;
  exception?: {
    values?: SentryException[];
  };
  request?: {
    url?: string;
    method?: string;
    data?: unknown;
  };
  extra?: Record<string, unknown>;
  tags?: Record<string, string>;
  level?: string;
  platform?: string;
}

interface ParsedError {
  errorType: string;
  errorMessage: string;
  culpritFile: string;
  culpritFunction: string;
  culpritLine: number;
  topFrames: SentryFrame[];
  requestUrl?: string;
  requestMethod?: string;
}

// ---------------------------------------------------------------------------
// Sentry API fetch
// ---------------------------------------------------------------------------

async function fetchSentryIssue(issueId: string): Promise<SentryEvent> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  if (!token) {
    throw new Error('SENTRY_AUTH_TOKEN env var is required for --issue-id mode');
  }

  const org = process.env.SENTRY_ORG ?? 'tristan-nolan';
  const _project = process.env.SENTRY_PROJECT ?? 'spawnforge-ai';

  return new Promise((resolve, reject) => {
    const options: https.RequestOptions = {
      hostname: 'sentry.io',
      path: `/api/0/organizations/${org}/issues/${issueId}/events/latest/`,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`Sentry API returned ${res.statusCode}: ${data.slice(0, 200)}`));
          return;
        }
        try {
          resolve(JSON.parse(data) as SentryEvent);
        } catch (err) {
          reject(new Error(`Failed to parse Sentry response: ${(err as Error).message}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Event parsing
// ---------------------------------------------------------------------------

function parseEvent(event: SentryEvent): ParsedError {
  const exception = event.exception?.values?.[0];
  const errorType = exception?.type ?? 'Error';
  const errorMessage = exception?.value ?? event.title ?? event.message ?? 'Unknown error';

  // Get in-app frames (prefer application frames over node_modules)
  const allFrames = exception?.stacktrace?.frames ?? [];
  const inAppFrames = allFrames.filter((f) => f.in_app !== false);
  const frames = inAppFrames.length > 0 ? inAppFrames : allFrames;

  // Top frame = last in Sentry's frame list (most recent call)
  const topFrame = frames[frames.length - 1] ?? {};
  const secondFrame = frames[frames.length - 2] ?? {};

  const culpritFile = topFrame.filename
    ?? topFrame.abs_path
    ?? event.culprit
    ?? 'unknown';

  const culpritFunction = topFrame.function ?? secondFrame.function ?? 'unknown';
  const culpritLine = topFrame.lineno ?? 0;

  // Return up to 5 most recent in-app frames
  const topFrames = frames.slice(-5).reverse();

  return {
    errorType,
    errorMessage,
    culpritFile,
    culpritFunction,
    culpritLine,
    topFrames,
    requestUrl: event.request?.url,
    requestMethod: event.request?.method,
  };
}

// ---------------------------------------------------------------------------
// File path utilities
// ---------------------------------------------------------------------------

/**
 * Convert a Sentry filename to the local repo-relative path.
 * Sentry filenames look like:
 *   "app:///_next/static/chunks/..." — compiled, skip
 *   "web/src/lib/tokens/creditManager.ts" — direct
 *   "/home/runner/work/.../web/src/..." — strip prefix
 */
function resolveLocalPath(sentryFilename: string): string | null {
  // Strip leading slashes and drive letters
  let p = sentryFilename.replace(/^[A-Za-z]:/, '').replace(/^\/+/, '');

  // Skip compiled / built files
  if (
    p.startsWith('_next/') ||
    p.startsWith('app://') ||
    p.includes('node_modules') ||
    p.includes('webpack-internal')
  ) {
    return null;
  }

  // Strip common CI prefixes
  const prefixes = [
    'home/runner/work/',
    'usr/local/lib/',
    'Users/',
  ];
  for (const prefix of prefixes) {
    const idx = p.indexOf(prefix);
    if (idx !== -1) {
      // Find web/src after the runner prefix
      const afterPrefix = p.slice(idx + prefix.length);
      const webIdx = afterPrefix.indexOf('web/src');
      if (webIdx !== -1) {
        p = afterPrefix.slice(webIdx);
        break;
      }
    }
  }

  // Ensure it starts with web/src or packages/ or apps/
  if (
    !p.startsWith('web/src') &&
    !p.startsWith('packages/') &&
    !p.startsWith('apps/')
  ) {
    // Try to salvage if it has web/src anywhere
    const webSrcIdx = p.indexOf('web/src');
    if (webSrcIdx !== -1) {
      p = p.slice(webSrcIdx);
    } else {
      return null;
    }
  }

  return p;
}

/**
 * Derive the test file path from the source file path.
 * web/src/lib/tokens/creditManager.ts
 *   → web/src/lib/tokens/__tests__/creditManager.sentry.test.ts
 */
function deriveTestPath(sourcePath: string): string {
  const dir = path.dirname(sourcePath);
  const base = path.basename(sourcePath, path.extname(sourcePath));
  return path.join(dir, '__tests__', `${base}.sentry.test.ts`);
}

/**
 * Derive the TypeScript import path from source → test location.
 * web/src/lib/tokens/__tests__/creditManager.sentry.test.ts
 *   → '../creditManager' (relative from __tests__/)
 */
function deriveImportPath(sourcePath: string): string {
  const base = path.basename(sourcePath, path.extname(sourcePath));
  return `../${base}`;
}

// ---------------------------------------------------------------------------
// Stub generation
// ---------------------------------------------------------------------------

function sanitizeComment(s: string): string {
  return s.replace(/\*\//g, '*\\/').replace(/^/gm, ' * ');
}

function generateTestStub(event: SentryEvent, parsed: ParsedError): string {
  const localFile = resolveLocalPath(parsed.culpritFile);
  const testPath = localFile ? deriveTestPath(localFile) : 'web/src/unknown/__tests__/sentry.test.ts';
  const importPath = localFile ? deriveImportPath(localFile) : '../unknown';

  const eventId = event.id ?? 'unknown';
  const requestSection = parsed.requestUrl
    ? `\n * Request: ${parsed.requestMethod ?? 'GET'} ${parsed.requestUrl}`
    : '';

  const framesSection = parsed.topFrames
    .map((f) => {
      const file = f.filename ?? f.abs_path ?? '?';
      const fn_ = f.function ?? '?';
      const line = f.lineno ?? '?';
      return ` *   at ${fn_} (${file}:${line})`;
    })
    .join('\n');

  const contextHint = parsed.topFrames[0]?.context_line?.trim()
    ? `\n * Context: \`${parsed.topFrames[0].context_line.trim()}\``
    : '';

  // Generate a describe/it structure based on the function name
  const describeName = parsed.culpritFunction !== 'unknown'
    ? parsed.culpritFunction
    : (localFile ? path.basename(localFile, path.extname(localFile)) : 'unknown');

  const errorSnippet = JSON.stringify(parsed.errorMessage).slice(0, 100);

  return `/**
 * Sentry regression stub — auto-generated by sentry-to-test-stub.ts
 *
 * Issue:   ${eventId}
 * Error:   ${parsed.errorType}: ${parsed.errorMessage.slice(0, 80)}
 * File:    ${parsed.culpritFile}
 * Line:    ${parsed.culpritLine}${requestSection}${contextHint}
 *
 * Stack (top frames):
${framesSection}
 *
 * Write the output to:
 *   ${testPath}
 *
 * TODO: Fill in imports, mocks, and specific assertions below.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
// TODO: Update this import to match the actual exported function/class
// import { ${describeName} } from '${importPath}';

describe('${describeName} — Sentry regression ${eventId}', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should not throw ${parsed.errorType}: ${sanitizeErrorForItBlock(parsed.errorMessage)}', async () => {
    // Arrange
    // TODO: Set up the conditions that triggered the Sentry error.
    // The original error was: ${parsed.errorType}: ${parsed.errorMessage.slice(0, 120)}
    //
    // Relevant source line:${contextHint || ' (context not available)'}

    // Act
    // TODO: Call the function that threw (${describeName}).
    // Example:
    // const result = await ${describeName}(/* args */);

    // Assert
    // TODO: Replace with the specific invariant that should hold.
    // expect(result).toBeDefined();
    // The error was: ${errorSnippet}
    // Replace toBeDefined() with a structural assertion, e.g.:
    // expect(result).toEqual(expect.objectContaining({ success: true }));
    expect(true).toBe(true); // placeholder — replace with real assertion
  });

  it('should handle the edge case that caused the Sentry error gracefully', () => {
    // TODO: Reproduce the specific input/state that caused the crash.
    // Error type ${parsed.errorType} often indicates: ${errorTypeHint(parsed.errorType)}

    // Act + Assert
    // TODO: Verify the code no longer throws or returns an error state.
    expect(() => {
      // TODO: inline the offending call here
    }).not.toThrow();
  });
});
`;
}

function sanitizeErrorForItBlock(msg: string): string {
  // Truncate and escape for an 'it' description string
  return msg
    .slice(0, 60)
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, ' ');
}

function errorTypeHint(errorType: string): string {
  const hints: Record<string, string> = {
    TypeError: 'null/undefined access, wrong type, or calling non-function',
    RangeError: 'out-of-bounds array index or invalid numeric value',
    ReferenceError: 'variable used before declaration or in wrong scope',
    SyntaxError: 'malformed JSON.parse() input or template literal issue',
    Error: 'explicit throw — check the message for context',
    UnhandledPromiseRejection: 'missing await or .catch() on a promise',
    NetworkError: 'fetch() failure — check request URL and error handling',
  };
  return hints[errorType] ?? 'check the stack trace for context';
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let event: SentryEvent | null = null;

  // Parse CLI args
  const issueIdIdx = args.indexOf('--issue-id');
  const jsonIdx = args.indexOf('--json');

  if (issueIdIdx !== -1) {
    const issueId = args[issueIdIdx + 1];
    if (!issueId) {
      process.stderr.write('Error: --issue-id requires a value\n');
      process.exit(1);
    }
    process.stderr.write(`Fetching Sentry issue ${issueId}...\n`);
    event = await fetchSentryIssue(issueId);
  } else if (jsonIdx !== -1) {
    const jsonStr = args[jsonIdx + 1];
    if (!jsonStr) {
      process.stderr.write('Error: --json requires a value\n');
      process.exit(1);
    }
    try {
      event = JSON.parse(jsonStr) as SentryEvent;
    } catch (err) {
      process.stderr.write(`Error: failed to parse --json: ${(err as Error).message}\n`);
      process.exit(1);
    }
  } else if (!process.stdin.isTTY) {
    // Read from stdin
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    const raw = Buffer.concat(chunks).toString();
    try {
      event = JSON.parse(raw) as SentryEvent;
    } catch (err) {
      process.stderr.write(`Error: failed to parse stdin JSON: ${(err as Error).message}\n`);
      process.exit(1);
    }
  } else {
    process.stderr.write(
      'Usage:\n' +
      '  cat sentry-event.json | npx ts-node scripts/sentry-to-test-stub.ts\n' +
      '  npx ts-node scripts/sentry-to-test-stub.ts --issue-id ISSUE_ID\n' +
      '  npx ts-node scripts/sentry-to-test-stub.ts --json \'{"title":"...",...}\'\n\n' +
      'Options:\n' +
      '  --issue-id  Sentry issue ID (requires SENTRY_AUTH_TOKEN env var)\n' +
      '  --json      Raw Sentry event JSON as a string\n' +
      '  (stdin)     Piped Sentry event JSON\n',
    );
    process.exit(1);
  }

  const parsed = parseEvent(event);
  const stub = generateTestStub(event, parsed);

  // Print the stub to stdout
  process.stdout.write(stub);

  // Print metadata to stderr so stdout stays clean for redirection
  const localFile = resolveLocalPath(parsed.culpritFile);
  process.stderr.write('\n--- Generated stub metadata ---\n');
  process.stderr.write(`Error:      ${parsed.errorType}: ${parsed.errorMessage.slice(0, 80)}\n`);
  process.stderr.write(`Source:     ${parsed.culpritFile} (line ${parsed.culpritLine})\n`);
  if (localFile) {
    process.stderr.write(`Local:      ${localFile}\n`);
    process.stderr.write(`Test file:  ${deriveTestPath(localFile)}\n`);
  }
  process.stderr.write('\nRedirect stdout to the test file to save it:\n');
  if (localFile) {
    process.stderr.write(`  npx ts-node scripts/sentry-to-test-stub.ts [...] > ${deriveTestPath(localFile)}\n`);
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`Fatal: ${(err as Error).message}\n`);
  process.exit(1);
});
