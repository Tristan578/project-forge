import { CommandFilter } from '../../components/CommandFilter';
import { readCommandsManifest } from '../../lib/commands';

/**
 * MCP Command Index Page
 *
 * Renders the public MCP command reference with:
 * - Partial-listing callout (spec Section 7.3)
 * - Faceted filtering (spec Section 7.2)
 * - Category listing
 */
export default async function McpIndexPage() {
  const { categories, scopes, publicCount } = await readCommandsManifest();

  return (
    <main style={{ maxWidth: '64rem', margin: '0 auto', padding: '2rem 1rem' }}>
      <h1
        style={{
          fontSize: '1.875rem',
          fontWeight: 700,
          marginBottom: '0.5rem',
          color: 'var(--foreground, #fafafa)',
        }}
      >
        MCP Commands
      </h1>
      <p
        style={{
          marginBottom: '1.5rem',
          color: 'rgba(250,250,250,0.7)',
          fontSize: '1rem',
        }}
      >
        Browse the SpawnForge MCP command reference. Control SpawnForge from AI tools — use these
        commands with Claude and other MCP-compatible clients.
      </p>

      {/* Partial listing notice — per spec Section 7.3 */}
      <div
        role="note"
        style={{
          padding: '0.875rem 1rem',
          marginBottom: '1.5rem',
          background: 'rgba(59,130,246,0.08)',
          border: '1px solid rgba(59,130,246,0.25)',
          borderRadius: '0.375rem',
          fontSize: '0.875rem',
          color: 'var(--foreground, #fafafa)',
        }}
      >
        <strong>Partial listing:</strong> Some commands require internal access and are not shown
        here. If you are a SpawnForge team member, contact the team for internal documentation
        access.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '16rem 1fr', gap: '2rem' }}>
        {/* Sidebar: faceted filter */}
        <aside>
          <CommandFilter
            categories={categories}
            scopes={scopes}
            totalCommands={publicCount}
            onFilterChange={() => {
              // Client-side filtering is handled within the component.
              // In a full Fumadocs integration this would update URL search params.
            }}
          />
        </aside>

        {/* Main content: category list */}
        <div>
          {publicCount === 0 ? (
            <p style={{ color: 'rgba(250,250,250,0.6)', fontStyle: 'italic' }}>
              No public commands available yet. Commands are being reviewed for public documentation.
            </p>
          ) : (
            <>
              <p style={{ marginBottom: '1rem', color: 'rgba(250,250,250,0.7)', fontSize: '0.875rem' }}>
                {publicCount} public commands across {categories.length} categories. Use the filters
                to narrow your search or browse by category below.
              </p>
              <ul
                style={{
                  listStyle: 'none',
                  padding: 0,
                  margin: 0,
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(14rem, 1fr))',
                  gap: '0.75rem',
                }}
              >
                {[...categories].sort().map((category) => (
                  <li key={category}>
                    <a
                      href={`/mcp/${category}`}
                      style={{
                        display: 'block',
                        padding: '0.75rem 1rem',
                        background: 'var(--muted, #18181b)',
                        border: '1px solid var(--border, #27272a)',
                        borderRadius: '0.375rem',
                        color: 'var(--foreground, #fafafa)',
                        textDecoration: 'none',
                        fontSize: '0.875rem',
                        fontWeight: 500,
                        transition: 'border-color 0.15s, background 0.15s',
                      }}
                    >
                      {category}
                    </a>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>
    </main>
  );
}
