/**
 * Lighthouse CI configuration for SpawnForge theme effects delta gate.
 *
 * Strategy: delta comparison (effects-on vs effects-off) rather than absolute floor.
 * A static floor is too coarse — it passes even if effects drop perf by 40 points.
 * The delta gate ensures effects cause < 0.05 (5 point) regression relative to baseline.
 *
 * The CI workflow runs two separate lhci collect passes and computes the delta
 * in a node script. See .github/workflows/quality-gates.yml lighthouse-delta job.
 */
module.exports = {
  ci: {
    collect: {
      url: [
        'http://localhost:3000/dev',
      ],
      // No startServerCommand — the CI workflow manages servers directly
      // (next build + next start) to avoid Portless dependency and env var issues.
      numberOfRuns: 3,
    },
    assert: {
      // No absolute floor — the delta script handles the gate.
      assertions: {},
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
