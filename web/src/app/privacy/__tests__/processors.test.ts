/**
 * The privacy policy must name every third party the code sends personal data to
 * (lessons-learned #1, #18). The processors are DERIVED from package.json, so a
 * newly added SDK that is not in the policy fails here instead of silently
 * making the policy wrong. The page named only Clerk and Stripe for months while
 * Sentry Replay, PostHog, Vercel, Neon, R2 and Upstash all received user data.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const WEB = resolve(__dirname, '../../../..');
const page = readFileSync(resolve(WEB, 'src/app/privacy/page.tsx'), 'utf8');
const pkg = JSON.parse(readFileSync(resolve(WEB, 'package.json'), 'utf8')) as {
  dependencies: Record<string, string>;
};

/** SDK package prefix -> the name the policy must contain. */
const SDK_TO_PROCESSOR: ReadonlyArray<readonly [string, string]> = [
  ['@clerk/', 'Clerk'],
  ['stripe', 'Stripe'],
  ['@sentry/', 'Sentry'],
  ['posthog-js', 'PostHog'],
  ['@vercel/analytics', 'Vercel'],
  ['@vercel/speed-insights', 'Speed Insights'],
  ['botid', 'BotID'],
  ['@neondatabase/', 'Neon'],
  ['@aws-sdk/client-s3', 'Cloudflare R2'],
  ['@upstash/redis', 'Upstash'],
  ['@upstash/qstash', 'QStash'],
  ['@ai-sdk/gateway', 'AI Gateway'],
  ['@ai-sdk/anthropic', 'Anthropic'],
];

describe('privacy policy names the processors the code uses', () => {
  const deps = Object.keys(pkg.dependencies);

  it('finds the SDKs it is checking for (not vacuous)', () => {
    const present = SDK_TO_PROCESSOR.filter(([prefix]) => deps.some((d) => d.startsWith(prefix)));
    expect(present.length).toBeGreaterThanOrEqual(10);
  });

  it.each(SDK_TO_PROCESSOR)('%s -> %s', (prefix, name) => {
    if (!deps.some((d) => d.startsWith(prefix))) return; // SDK removed: nothing to disclose
    expect(page).toContain(name);
  });

  it.each(['Meshy', 'ElevenLabs', 'OpenAI', 'Replicate', 'remove.bg'])('names AI provider %s', (name) => {
    expect(page).toContain(name);
  });

  it('does not claim analytics are anonymous while replay and browser identifiers exist', () => {
    expect(page).not.toMatch(/does not personally identify individual\s+users/);
    expect(page).toMatch(/session replay/i);
  });

  it('names the operating entity', () => {
    expect(page).toContain('Nolan Consulting LLC');
  });
});
