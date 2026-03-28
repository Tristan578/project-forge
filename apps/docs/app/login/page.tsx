/**
 * Simple token-based login page for internal docs.
 * Only rendered when DOCS_AUTH_TOKEN is set in the environment.
 */
export default function LoginPage() {
  return (
    <html lang="en" className="dark">
      <body
        style={{
          background: '#09090b',
          color: '#fafafa',
          fontFamily: 'system-ui, sans-serif',
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <main
          style={{
            maxWidth: '24rem',
            width: '100%',
            padding: '2rem',
          }}
        >
          <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>
            SpawnForge Internal Docs
          </h1>
          <p style={{ color: 'rgba(250,250,250,0.6)', marginBottom: '1.5rem', fontSize: '0.875rem' }}>
            This documentation is restricted to team members. Enter your access token to continue.
          </p>
          <form action="/api/login" method="POST">
            <input type="hidden" name="next" value="/" />
            <label
              htmlFor="token"
              style={{ display: 'block', fontSize: '0.875rem', marginBottom: '0.375rem', fontWeight: 500 }}
            >
              Access Token
            </label>
            <input
              id="token"
              name="token"
              type="password"
              required
              autoFocus
              autoComplete="current-password"
              placeholder="Enter your docs access token"
              style={{
                width: '100%',
                padding: '0.625rem 0.75rem',
                background: '#18181b',
                border: '1px solid #27272a',
                borderRadius: '0.375rem',
                color: '#fafafa',
                fontSize: '0.875rem',
                marginBottom: '1rem',
                boxSizing: 'border-box',
              }}
            />
            <button
              type="submit"
              style={{
                width: '100%',
                padding: '0.625rem',
                background: '#3b82f6',
                color: '#fff',
                border: 'none',
                borderRadius: '0.375rem',
                fontSize: '0.875rem',
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              Sign In
            </button>
          </form>
        </main>
      </body>
    </html>
  );
}
