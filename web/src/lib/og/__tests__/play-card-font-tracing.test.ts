// @vitest-environment node
/** Pin local font inclusion for actual Next share-card function route variants. */
import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';

vi.mock('@sentry/nextjs', () => ({ withSentryConfig: (config: unknown) => config }));
vi.mock('@next/bundle-analyzer', () => ({ default: () => (config: unknown) => config }));
vi.mock('next-intl/plugin', () => ({ default: () => (config: unknown) => config }));
vi.mock('botid/next/config', () => ({ withBotId: (config: unknown) => config }));
import config from '../../../../next.config';

const picomatch = createRequire(import.meta.url)('next/dist/compiled/picomatch') as
  (pattern: string) => (path: string) => boolean;
const fonts = [
  './src/assets/fonts/NotoSans-Regular.ttf',
  './src/assets/fonts/SpawnForgeArabic-Regular.ttf',
  './src/assets/fonts/NotoSansCJKjp-Regular.otf',
];

describe('play-card serverless font tracing', () => {
  it.each([
    '/play/[userId]/[slug]/opengraph-image',
    '/play/[userId]/[slug]/opengraph-image/[[...__metadata_id__]]',
  ])('explicitly includes each runtime font for %s', route => {
    const included = Object.entries(config.outputFileTracingIncludes ?? {})
      .filter(([pattern]) => picomatch(pattern)(route)).flatMap(([, files]) => files);
    expect([...new Set(included)].sort()).toEqual([...fonts].sort());
    for (const file of fonts) expect(existsSync(new URL('../../../../' + file, import.meta.url))).toBe(true);
    expect(included.some(file => file.includes('/scripts/fonts/'))).toBe(false);
  });
});
