import type { NextConfig } from 'next';
import { assertClerkPublishableKeyShape } from './lib/clerk';

// Fail the build on a configured-but-unusable Clerk publishable key (#9044).
// A MISSING key is fine and stays fine — local checkouts and CI build without
// one. A key that is PRESENT but cannot work is always a paste error, and the
// old behaviour treated it as "Clerk is not set up here": docs.spawnforge.ai
// shipped with every sign-in dead and no signal anywhere. Checked here rather
// than at runtime so the deploy goes red instead of the live site.
assertClerkPublishableKeyShape();

// Defense-in-depth: INCLUDE_INTERNAL requires IS_INTERNAL_DOCS_BUILD
if (process.env.INCLUDE_INTERNAL === 'true' && !process.env.IS_INTERNAL_DOCS_BUILD) {
  throw new Error(
    'INCLUDE_INTERNAL=true requires IS_INTERNAL_DOCS_BUILD=true. ' +
    'Only the internal Vercel project (with Deployment Protection) may have these vars.'
  );
}

const nextConfig: NextConfig = {};
export default nextConfig;
