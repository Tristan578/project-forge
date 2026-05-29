import Link from 'next/link';

/**
 * Pre-launch sign-up notice.
 *
 * Sign-ups are intentionally disabled while SpawnForge is in development.
 * Rather than render Clerk's <SignUp> in restricted mode — which shows a
 * support-contact error that reads as "action required" and drives a flood
 * of support emails — we show a clear "coming soon" notice with a single,
 * optional way to register interest. Sign-in is unaffected; approved users
 * still authenticate normally at /sign-in.
 */
export function SignUpClient() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6">
      <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-900/50 p-8 text-center">
        <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-1.5 text-sm text-zinc-300">
          SpawnForge
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">
          SpawnForge is in development
        </h1>
        <p className="mt-4 text-base leading-relaxed text-zinc-400">
          Release details and timeline will be published soon.
        </p>
        <p className="mt-6 text-sm text-zinc-400">
          Interested in being an early user?{' '}
          <a
            href="mailto:support@spawnforge.ai"
            className="font-medium text-blue-400 underline-offset-4 transition-colors hover:text-blue-300 hover:underline"
          >
            support@spawnforge.ai
          </a>
        </p>
        <Link
          href="/"
          className="mt-8 inline-flex items-center justify-center rounded-lg border border-zinc-700 px-5 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
        >
          Back to home
        </Link>
      </div>
    </main>
  );
}
