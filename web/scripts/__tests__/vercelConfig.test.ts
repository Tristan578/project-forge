/**
 * @vitest-environment node
 *
 * Pins the exact values in `vercel.ts` (PF-1060 / #9097). This migration's
 * whole point is that a bad edit fails `tsc --noEmit`; this suite is the
 * runtime half — it fails a mutation to any load-bearing value even though
 * TypeScript would happily accept a different (wrong) string, boolean, or
 * array here.
 *
 * Each assertion below was mutated (value flipped/altered) and confirmed to
 * turn this suite red before being restored — see the PR description.
 */
import { describe, expect, it } from 'vitest';
import { config } from '../../vercel';

describe('vercel.ts config', () => {
  it('keeps the single-root-lockfile install command intact', () => {
    // Must reach ABOVE web/ (`cd ..`) because package-lock.json lives at the
    // repo root. Losing "cd .." here breaks every build (see file header).
    expect(config.installCommand).toBe('cd .. && npm ci && npm run build --workspace=packages/ui');
  });

  it('keeps git-triggered deploys disabled', () => {
    // Deploys are driven by cd.yml, not Vercel's own git integration.
    // Losing this starts double-deploying every push.
    expect(config.git).toEqual({ deploymentEnabled: false });
  });

  it('preserves framework, build command, and output directory', () => {
    expect(config.framework).toBe('nextjs');
    expect(config.buildCommand).toBe('npm run build');
    expect(config.outputDirectory).toBe('.next');
  });

  it('keeps the deployment region pinned to iad1', () => {
    expect(config.regions).toEqual(['iad1']);
  });

  it('keeps exactly one health-monitor cron, on its existing schedule', () => {
    expect(config.crons).toEqual([
      {
        path: '/api/cron/health-monitor',
        schedule: '*/15 * * * *',
      },
    ]);
  });
});
