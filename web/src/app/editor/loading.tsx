/**
 * `h-full`, not `h-screen`: every screen under /editor renders inside
 * <ViewportLock> (`h-dvh overflow-hidden`). A `100vh` box is taller than the
 * dynamic viewport on mobile, and the lock CLIPS the excess rather than
 * scrolling it — the centred spinner drifts below the fold with no way to
 * reach it. `h-full` is 100% of the lock. Guarded by public-scroll.test.ts.
 */
export default function EditorLoading() {
  return (
    <div className="flex h-full w-full items-center justify-center bg-zinc-950">
      <div className="flex flex-col items-center gap-4">
        {/* Spinner */}
        <div
          className="h-10 w-10 animate-spin rounded-full border-2 border-zinc-700 border-t-blue-500"
          role="status"
          aria-label="Loading editor"
        />
        <p className="text-sm text-zinc-400">Loading editor...</p>
      </div>
    </div>
  );
}
