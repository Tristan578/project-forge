import Link from 'next/link';

interface TocItem {
  id: string;
  label: string;
}

interface LegalLayoutProps {
  title: string;
  lastUpdated: string;
  tableOfContents: TocItem[];
  children: React.ReactNode;
}

export function LegalLayout({
  title,
  lastUpdated,
  tableOfContents,
  children,
}: LegalLayoutProps) {
  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <Link href="/" className="text-2xl font-bold hover:text-zinc-300">
            SpawnForge
          </Link>
          <nav className="flex items-center gap-6 text-sm text-zinc-400">
            <Link href="/terms" className="hover:text-white">
              Terms of Service
            </Link>
            <Link href="/privacy" className="hover:text-white">
              Privacy Policy
            </Link>
          </nav>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-12 lg:flex lg:gap-12">
        {/* Sidebar - Table of Contents */}
        <aside className="mb-10 lg:mb-0 lg:w-64 lg:shrink-0">
          <div className="lg:sticky lg:top-12">
            <Link
              href="/"
              className="mb-6 inline-flex items-center gap-2 text-sm text-zinc-400 hover:text-white"
            >
              <span aria-hidden="true">&larr;</span> Back to home
            </Link>
            <nav className="hidden lg:block">
              <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-zinc-400">
                On this page
              </h2>
              <ul className="space-y-2 border-l border-zinc-800 pl-4">
                {tableOfContents.map((item) => (
                  <li key={item.id}>
                    <a
                      href={`#${item.id}`}
                      className="block text-sm text-zinc-400 hover:text-white"
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </div>
        </aside>

        {/* Main Content */}
        <main className="min-w-0 flex-1">
          <article className="mx-auto max-w-3xl">
            <header className="mb-10">
              <h1 className="mb-3 text-4xl font-bold tracking-tight">
                {title}
              </h1>
              <p className="text-sm text-zinc-400">
                Last updated: {lastUpdated}
              </p>
            </header>

            <div className="prose-legal space-y-10 text-zinc-300 leading-relaxed [&_h2]:mb-4 [&_h2]:mt-12 [&_h2]:text-2xl [&_h2]:font-semibold [&_h2]:text-zinc-100 [&_h3]:mb-3 [&_h3]:mt-6 [&_h3]:text-lg [&_h3]:font-medium [&_h3]:text-zinc-200 [&_p]:mb-4 [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-2 [&_ol]:mb-4 [&_ol]:list-decimal [&_ol]:pl-6 [&_ol]:space-y-2 [&_a]:text-blue-400 [&_a]:underline [&_a:hover]:text-blue-300 [&_strong]:text-zinc-100">
              {children}
            </div>
          </article>
        </main>
      </div>

      {/* Footer */}
      <footer className="mt-16 border-t border-zinc-800 px-6 py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center gap-4 text-sm text-zinc-400 sm:flex-row sm:justify-between">
          <p>&copy; {new Date().getFullYear()} SpawnForge. All rights reserved.</p>
          <nav className="flex gap-6">
            <Link href="/terms" className="hover:text-zinc-300">
              Terms of Service
            </Link>
            <Link href="/privacy" className="hover:text-zinc-300">
              Privacy Policy
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
