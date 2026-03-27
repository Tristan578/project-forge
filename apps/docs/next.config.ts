import type { NextConfig } from 'next';

// Defense-in-depth: INCLUDE_INTERNAL requires IS_INTERNAL_DOCS_BUILD
if (process.env.INCLUDE_INTERNAL === 'true' && !process.env.IS_INTERNAL_DOCS_BUILD) {
  throw new Error(
    'INCLUDE_INTERNAL=true requires IS_INTERNAL_DOCS_BUILD=true. ' +
    'Only the internal Vercel project (with Deployment Protection) may have these vars.'
  );
}

const nextConfig: NextConfig = {};
export default nextConfig;
