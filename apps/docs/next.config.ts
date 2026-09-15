import type { NextConfig } from 'next';
import { createMDX } from 'fumadocs-mdx/next';
import { assertClerkPublishableKeyShape } from './lib/clerk';

// Fail the build on a Clerk configuration that cannot work. A MISSING pair is
// fine and stays fine — local checkouts and CI build without Clerk. What fails:
// a PRESENT-but-unusable publishable key (#9044, a paste error), and a set
// CLERK_SECRET_KEY with an ABSENT publishable key (#9721) — the half-configured
// state that shipped docs.spawnforge.ai with sign-in dead and "Missing
// publishableKey" on every request. Both were once treated as "Clerk is not set
// up here". Checked here rather than at runtime so the deploy goes red instead
// of the live site. Reads NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY
// from process.env by default.
assertClerkPublishableKeyShape();

// Defense-in-depth: INCLUDE_INTERNAL requires IS_INTERNAL_DOCS_BUILD
if (process.env.INCLUDE_INTERNAL === 'true' && !process.env.IS_INTERNAL_DOCS_BUILD) {
  throw new Error(
    'INCLUDE_INTERNAL=true requires IS_INTERNAL_DOCS_BUILD=true. ' +
    'Only the internal Vercel project (with Deployment Protection) may have these vars.'
  );
}

const nextConfig: NextConfig = {};

// Compile the MDX under `content/` and generate the `.source` loader index that
// `lib/source.ts` consumes. Without this the 291 generated command pages plus
// the two index pages never compile and nothing can render them (#9061). The
// Clerk and INCLUDE_INTERNAL guards above stay in force — they run at module
// load, before this wrapper is applied.
const withMDX = createMDX();

export default withMDX(nextConfig);
