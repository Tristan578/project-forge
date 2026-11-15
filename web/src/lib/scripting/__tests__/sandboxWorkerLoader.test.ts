// @vitest-environment node
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { parse } from 'acorn';
import { describe, expect, it } from 'vitest';

/*
 * The sandboxed-origin transport ships the worker as TEXT, produced at build
 * time by scripts/sandbox-worker-loader.cjs in place of the placeholder module
 * (see sandboxOrigin.ts for why). If the loader output were not one import-free
 * classic script, the null-origin frame could not run it; if next.config.ts
 * lost the rule for either bundler, the flag would ship an empty string. Both
 * are invisible until someone turns the flag on — hence this file.
 */

interface SandboxWorkerLoader {
  (this: unknown): void;
  bundleScriptWorker(): Promise<{ code: string; inputs: string[] }>;
}

const WEB = process.cwd();
const LOADER_PATH = join(WEB, 'scripts', 'sandbox-worker-loader.cjs');
const PLACEHOLDER = join(WEB, 'src', 'lib', 'scripting', 'scriptWorkerSource.bundle.ts');
const WORKER = join(WEB, 'src', 'lib', 'scripting', 'scriptWorker.ts');
const loader = createRequire(__filename)(LOADER_PATH) as SandboxWorkerLoader;

type Node = { type: string; [key: string]: unknown };
function* walk(node: unknown): Generator<Node> {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child);
    return;
  }
  const n = node as Node;
  if (typeof n.type === 'string') yield n;
  for (const [key, value] of Object.entries(n)) {
    if (key !== 'type') yield* walk(value);
  }
}

/** The files scriptWorker.ts imports at RUN time (type-only imports excluded), resolved. */
function runtimeImportsOfWorker(): string[] {
  const source = readFileSync(WORKER, 'utf8');
  const specs = [...source.matchAll(/^import\s+(?!type\s)[^;]*?from\s+'([^']+)';/gm)].map((m) => m[1]);
  return specs.map((spec) =>
    spec.startsWith('@/') ? join(WEB, 'src', `${spec.slice(2)}.ts`) : resolve(dirname(WORKER), `${spec}.ts`),
  );
}

describe('sandbox worker loader', () => {
  it('bundles the whole worker graph into ONE classic script that loads nothing', async () => {
    const { code, inputs } = await loader.bundleScriptWorker();
    // sourceType 'script' rejects import/export declarations outright.
    const ast = parse(code, { ecmaVersion: 'latest', sourceType: 'script' });
    const loads = [...walk(ast)].filter(
      (n) =>
        n.type === 'ImportExpression' ||
        (n.type === 'CallExpression' &&
          (n.callee as Node).type === 'Identifier' &&
          ['importScripts', 'require'].includes((n.callee as { name: string }).name)),
    );
    expect(loads).toEqual([]);

    const imports = runtimeImportsOfWorker();
    expect(imports.length).toBeGreaterThanOrEqual(4); // a parse that found nothing proves nothing
    for (const file of [WORKER, ...imports]) {
      expect(existsSync(file), file).toBe(true);
      expect(inputs, file).toContain(file);
    }
  });

  it('emits `export default <string>` for the placeholder and registers every input as a dependency', async () => {
    const dependencies: string[] = [];
    const output = await new Promise<string>((done, fail) => {
      loader.call({
        resourcePath: PLACEHOLDER,
        async: () => (err: Error | null, out?: string) => (err ? fail(err) : done(out as string)),
        addDependency: (file: string) => dependencies.push(file),
      });
    });
    const program = parse(output, { ecmaVersion: 'latest', sourceType: 'module' }) as unknown as { body: Node[] };
    expect(program.body).toHaveLength(1);
    const decl = program.body[0] as { type: string; declaration: { type: string; value: unknown } };
    expect(decl.type).toBe('ExportDefaultDeclaration');
    expect(decl.declaration.type).toBe('Literal');
    const { code, inputs } = await loader.bundleScriptWorker();
    expect(decl.declaration.value).toBe(code);
    expect([...dependencies].sort()).toEqual([...inputs].sort());
    expect(dependencies).toContain(WORKER);
  });

  it('next.config.ts registers the loader for the placeholder under BOTH bundlers, after every wrapper', () => {
    // Load the REAL config the way Next does, in a child process (it has side
    // effects and wrappers — Sentry, BotId, next-intl, the analyzer — any of
    // which could drop a rule), then run its final webpack() on a minimal config.
    const child = `
      const loadConfig = require('next/dist/server/config').default;
      const { PHASE_PRODUCTION_BUILD, PHASE_DEVELOPMENT_SERVER } = require('next/constants');
      (async () => {
        const out = {};
        for (const phase of [PHASE_PRODUCTION_BUILD, PHASE_DEVELOPMENT_SERVER]) {
          const cfg = await loadConfig(phase, process.cwd());
          const fake = { context: process.cwd(), entry: async () => ({}), module: { rules: [] }, plugins: [],
            resolve: { alias: {}, modules: [] }, resolveLoader: { alias: {}, modules: [] }, optimization: {},
            output: { path: process.cwd() + '/.next' }, devtool: false };
          const result = cfg.webpack(fake, { dev: phase === PHASE_DEVELOPMENT_SERVER, isServer: false, buildId: 'test',
            dir: process.cwd(), config: cfg, defaultLoaders: {}, webpack: require('next/dist/compiled/webpack/webpack-lib') });
          out[phase] = {
            turbopack: (cfg.turbopack && cfg.turbopack.rules) || {},
            webpack: result.module.rules.filter((r) => r && r.test instanceof RegExp)
              .map((r) => ({ source: r.test.source, flags: r.test.flags, enforce: r.enforce, use: r.use })),
          };
        }
        process.stdout.write(JSON.stringify(out));
      })().catch((e) => { console.error(e); process.exit(1); });
    `;
    const raw = execFileSync(process.execPath, ['-e', child], {
      cwd: WEB,
      env: { ...process.env, SKIP_ENV_VALIDATION: 'true' },
      encoding: 'utf8',
    });
    const phases = JSON.parse(raw.slice(raw.indexOf('{"'))) as Record<
      string,
      {
        turbopack: Record<string, { loaders?: string[]; as?: string }>;
        webpack: Array<{ source: string; flags: string; enforce?: string; use?: Array<{ loader: string }> }>;
      }
    >;
    expect(Object.keys(phases)).toHaveLength(2);
    for (const [phase, { turbopack, webpack }] of Object.entries(phases)) {
      // Turbopack matches rule keys against the file NAME.
      const turbo = turbopack[basename(PLACEHOLDER)];
      expect(turbo, `${phase}: turbopack rule`).toBeDefined();
      expect(turbo.loaders?.map((l) => resolve(l)), phase).toEqual([LOADER_PATH]);
      expect(turbo.as, phase).toBe('*.js');

      const matching = webpack.filter((r) => new RegExp(r.source, r.flags).test(PLACEHOLDER));
      expect(matching, `${phase}: webpack rule`).toHaveLength(1);
      expect(matching[0].enforce, phase).toBe('pre');
      expect(matching[0].use?.map((u) => resolve(u.loader)), phase).toEqual([LOADER_PATH]);
      // It must not swallow the real worker module, which the revoke transport
      // still bundles as a normal module Worker.
      expect(new RegExp(matching[0].source, matching[0].flags).test(WORKER), phase).toBe(false);
    }
  });
});
