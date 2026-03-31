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
        'http://localhost:3000',
      ],
      // No startServerCommand — the CI workflow manages servers directly
      // (next build + next start) to avoid Portless dependency and env var issues.
      numberOfRuns: 3,
    },
    assert: {
      // Absolute floors for Core Web Vitals on marketing pages.
      // These values MUST match performanceTargets.ts CWV_MARKETING_* constants.
      // Lighthouse does not measure INP (lab-only metric); TBT is the lab proxy.
      // The delta script (quality-gates.yml) handles theme effects regression.
      //
      // Source of truth: web/src/lib/config/performanceTargets.ts
      //   LCP 2500 = CWV_MARKETING_LCP_MS
      //   CLS 0.1  = CWV_MARKETING_CLS
      //   TBT 200  = proxy for CWV_MARKETING_INP_MS (lab equivalent)
      assertions: {
        'largest-contentful-paint': ['warn', { maxNumericValue: 2500 }],
        'cumulative-layout-shift': ['warn', { maxNumericValue: 0.1 }],
        'total-blocking-time': ['warn', { maxNumericValue: 200 }],
      },
    },
    upload: {
      target: 'temporary-public-storage',
    },
  },
};
