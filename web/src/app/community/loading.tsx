export default function CommunityLoading() {
  return (
    <div className="min-h-screen bg-zinc-950 p-6">
      {/* Page title skeleton */}
      <div className="mb-8 flex flex-col gap-3">
        <div className="h-8 w-56 animate-pulse rounded bg-zinc-800" />
        <div className="h-4 w-80 animate-pulse rounded bg-zinc-800" />
      </div>

      {/* Filter bar skeleton */}
      <div className="mb-6 flex gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-8 w-20 animate-pulse rounded-full bg-zinc-800" />
        ))}
      </div>

      {/* Game cards grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-3 h-40 animate-pulse rounded bg-zinc-800" />
            <div className="mb-2 h-5 w-3/4 animate-pulse rounded bg-zinc-800" />
            <div className="mb-3 h-4 w-full animate-pulse rounded bg-zinc-800" />
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 animate-pulse rounded-full bg-zinc-800" />
              <div className="h-4 w-24 animate-pulse rounded bg-zinc-800" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
