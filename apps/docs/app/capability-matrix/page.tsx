import type { Metadata } from 'next';
import { CapabilityMatrixDocument } from '../../components/CapabilityMatrixDocument';
import { hasMatrixRows, readCapabilityMatrix } from '../../lib/capabilityMatrix';

/**
 * The capability matrix (#9720): which capability works today through which
 * entry point — editor UI, in-app AI, game scripts, external MCP — with one of
 * five statuses per cell and the issue tracking every gap.
 *
 * Rendered from `data/capability-matrix.json`, the in-root copy of the
 * canonical `docs/capability-matrix.md` that `lib/capabilityMatrix.ts` imports
 * statically (a runtime file read is what 500'd `/mcp` in production, #9718).
 * The copy is pinned line-for-line against the canonical file by
 * `web/src/lib/config/__tests__/capabilityMatrix.test.ts` (which also fails
 * when a generation capability or manifest category has no row) and by
 * `scripts/check-manifest-sync.ts`, so this page cannot quietly fall behind
 * the code it describes.
 *
 * Listed in `proxy.ts` PUBLIC_ROUTES and `robots.ts`: the point of the page is
 * that a prospective creator can read it without an account.
 */

const CANONICAL_URL = 'https://github.com/Tristan578/project-forge/blob/main/docs/capability-matrix.md';

export const metadata: Metadata = {
  title: 'Capability matrix',
  description:
    'Which SpawnForge capabilities are proven, implemented but unverified, partial or unavailable through the editor UI, the in-app AI, game scripts and external MCP.',
};

export default function CapabilityMatrixPage() {
  const doc = readCapabilityMatrix();

  return (
    <main style={{ maxWidth: '72rem', margin: '0 auto', padding: '2rem 1rem' }}>
      <nav style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>
        <a href="/" style={{ color: 'rgba(250,250,250,0.7)' }}>
          &larr; Documentation home
        </a>
      </nav>

      {hasMatrixRows(doc) ? (
        <CapabilityMatrixDocument doc={doc} />
      ) : (
        // An empty table would read as "nothing is limited" — the opposite of
        // what the file says — so a copy with no matrix rows is an explicit
        // notice. (The copy cannot be MISSING: it is a static import, and a
        // missing file fails the build.)
        <p role="alert" style={{ color: 'var(--foreground, #fafafa)' }}>
          The capability matrix shipped with this deployment carries no rows. The canonical copy is at{' '}
          <a href={CANONICAL_URL} style={{ color: '#93c5fd', textDecoration: 'underline' }}>
            docs/capability-matrix.md
          </a>
          .
        </p>
      )}
    </main>
  );
}
