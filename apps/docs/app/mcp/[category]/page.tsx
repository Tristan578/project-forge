import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import {
  readCommandsByCategory,
  readCommandsManifest,
  toParameterList,
} from '../../../lib/commands';

/**
 * MCP Category Index — the destination of the category tiles on `/mcp`.
 *
 * Every tile on `/mcp` linked to `/mcp/${category}` while no such route existed,
 * so all 35 tiles 404'd (#9046). This renders the real command reference for one
 * category out of `data/commands.json` — the same manifest `/mcp` already counts
 * from — rather than a placeholder.
 *
 * It deliberately does NOT route at the generated MDX under `content/mcp/`: that
 * content is written one file per COMMAND (`scripts/generate-mcp-docs.ts` emits
 * `${cmd.name}.mdx`), so no per-category document exists there to render, and
 * nothing in the app renders `content/` at all today.
 *
 * `proxy.ts` already lists `/mcp/(.*)` in PUBLIC_ROUTES, so this needs no auth
 * change.
 */

interface CategoryPageProps {
  params: Promise<{ category: string }>;
}

/**
 * Statically enumerate the categories so the tiles on `/mcp` are all covered.
 * `app/layout.tsx` sets `dynamic = 'force-dynamic'`, so this is a correctness
 * declaration rather than a build-time prerender today — it keeps the param set
 * pinned to the manifest if that ever changes.
 */
export async function generateStaticParams(): Promise<{ category: string }[]> {
  const { categories } = await readCommandsManifest();
  return categories.map((category) => ({ category }));
}

export async function generateMetadata({ params }: CategoryPageProps): Promise<Metadata> {
  const { category } = await params;
  const commands = await readCommandsByCategory(category);
  if (commands.length === 0) {
    return { title: 'Category not found' };
  }
  return {
    title: `${category} MCP commands`,
    description: `${commands.length} public SpawnForge MCP commands in the ${category} category.`,
  };
}

export default async function McpCategoryPage({ params }: CategoryPageProps) {
  const { category } = await params;
  const commands = await readCommandsByCategory(category);

  // An unknown slug is a 404, not an empty page. Every category reachable from
  // `/mcp` has at least one public command by construction, so "no commands"
  // and "no such category" are the same condition here.
  if (commands.length === 0) {
    notFound();
  }

  return (
    <main style={{ maxWidth: '64rem', margin: '0 auto', padding: '2rem 1rem' }}>
      <nav style={{ marginBottom: '1rem', fontSize: '0.875rem' }}>
        <a href="/mcp" style={{ color: 'rgba(250,250,250,0.7)' }}>
          &larr; All MCP commands
        </a>
      </nav>

      <h1
        style={{
          fontSize: '1.875rem',
          fontWeight: 700,
          marginBottom: '0.5rem',
          color: 'var(--foreground, #fafafa)',
        }}
      >
        {category}
      </h1>
      <p
        style={{
          marginBottom: '2rem',
          color: 'rgba(250,250,250,0.7)',
          fontSize: '1rem',
        }}
      >
        {commands.length} public {commands.length === 1 ? 'command' : 'commands'} in this
        category.
      </p>

      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {commands.map((cmd) => {
          const parameters = toParameterList(cmd);
          return (
            <li
              key={cmd.name}
              id={cmd.name}
              style={{
                padding: '1rem 1.25rem',
                marginBottom: '1rem',
                background: 'var(--muted, #18181b)',
                border: '1px solid var(--border, #27272a)',
                borderRadius: '0.375rem',
              }}
            >
              <h2
                style={{
                  fontSize: '1.125rem',
                  fontWeight: 600,
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  margin: 0,
                  color: 'var(--foreground, #fafafa)',
                }}
              >
                {cmd.name}
              </h2>

              {cmd.description && (
                <p
                  style={{
                    margin: '0.5rem 0 0',
                    color: 'rgba(250,250,250,0.75)',
                    fontSize: '0.9375rem',
                  }}
                >
                  {cmd.description}
                </p>
              )}

              <p
                style={{
                  margin: '0.5rem 0 0',
                  color: 'rgba(250,250,250,0.55)',
                  fontSize: '0.8125rem',
                }}
              >
                {cmd.requiredScope && <>Scope: <code>{cmd.requiredScope}</code>. </>}
                Token cost: {cmd.tokenCost ?? 0}.
              </p>

              {parameters.length > 0 && (
                <dl style={{ margin: '0.75rem 0 0' }}>
                  {parameters.map((param) => (
                    <div key={param.name} style={{ marginTop: '0.5rem' }}>
                      <dt
                        style={{
                          fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                          fontSize: '0.8125rem',
                          color: 'var(--foreground, #fafafa)',
                        }}
                      >
                        {param.name}
                        <span style={{ color: 'rgba(250,250,250,0.5)', fontWeight: 400 }}>
                          {' '}
                          {param.type}
                          {param.required ? ' (required)' : ' (optional)'}
                        </span>
                      </dt>
                      {param.description && (
                        <dd
                          style={{
                            margin: '0.125rem 0 0',
                            color: 'rgba(250,250,250,0.65)',
                            fontSize: '0.8125rem',
                          }}
                        >
                          {param.description}
                        </dd>
                      )}
                    </div>
                  ))}
                </dl>
              )}
            </li>
          );
        })}
      </ul>
    </main>
  );
}
