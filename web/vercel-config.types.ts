/**
 * SpawnForge's supported subset of the official Vercel project schema:
 * https://openapi.vercel.sh/vercel.json
 * https://vercel.com/docs/project-configuration/vercel-ts
 *
 * Deliberately not a general VercelConfig replacement: all fields we deploy
 * are required, and unsupported fields must be reviewed against the schema
 * before extending this type. Keep the config a directly typed object literal
 * so TypeScript checks excess properties, including nested git/cron entries.
 * Runtime value pins live in scripts/__tests__/vercelConfig.test.ts; this type
 * does not validate cron syntax, region names, or other string constraints.
 *
 * This local type removes the type-only @vercel/config dependency and its
 * unpatched Zod v3 subtree (GHSA-mrhx-c7xc-m3w5), without a major-version
 * override or an audit exemption. It must never introduce runtime imports.
 */
export interface DeploymentConfig {
  framework: 'nextjs';
  installCommand: string;
  buildCommand: string;
  outputDirectory: string;
  regions: string[];
  git: {
    deploymentEnabled: boolean;
  };
  crons: {
    path: `/${string}`;
    schedule: string;
  }[];
}
