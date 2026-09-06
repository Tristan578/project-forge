export default function DocsHome() {
  return (
    <main>
      <h1>SpawnForge Documentation</h1>
      <ul>
        <li>
          <a href="/mcp"><strong>MCP Commands</strong></a> — Control SpawnForge from AI tools. Browse every public command available to Claude and other MCP clients; the reference counts them from the shipped manifest.
        </li>
        <li>
          <a href="/capability-matrix"><strong>Capability Matrix</strong></a> — Which capabilities are proven, implemented but unverified, partial or unavailable today through the editor, the in-app AI, game scripts and external MCP, with the issue tracking every gap.
        </li>
        {/*
          Deliberately NOT a link. This pointed at `/api`, which has never had a
          route in this app (#9046). Three things say the page is not meant to
          exist yet, so the fix is to stop advertising it rather than to stand up
          a stub: `content/api/index.mdx` says the reference is coming soon,
          `app/robots.ts` already disallows `/api` for crawlers, and `/api` is an
          API namespace rather than a docs path. Turn this back into an <a> when
          the REST reference actually ships — and drop the `/api` entry from
          robots.ts in the same change.
        */}
        <li>
          <strong>API Reference</strong> — REST API for external integrations. Coming soon: the reference publishes once the API middleware ships with schema validation. Until then, <a href="/mcp">the MCP command reference</a> covers the same capabilities.
        </li>
      </ul>
      <footer>SpawnForge Documentation — Built by Tristan Nolan</footer>
    </main>
  );
}
