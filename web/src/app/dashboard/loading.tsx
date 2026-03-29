export default function DashboardLoading() {
  return (
    <div className="flex min-h-screen flex-col bg-zinc-950 p-6">
      {/* Header skeleton */}
      <div className="mb-8 flex items-center justify-between">
        <div className="h-7 w-40 animate-pulse rounded bg-zinc-800" />
        <div className="h-9 w-32 animate-pulse rounded bg-zinc-800" />
      </div>

      {/* Stats row */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-2 h-4 w-24 animate-pulse rounded bg-zinc-800" />
            <div className="h-8 w-16 animate-pulse rounded bg-zinc-800" />
          </div>
        ))}
      </div>

      {/* Project cards grid */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            <div className="mb-3 h-32 animate-pulse rounded bg-zinc-800" />
            <div className="mb-2 h-5 w-3/4 animate-pulse rounded bg-zinc-800" />
            <div className="h-4 w-1/2 animate-pulse rounded bg-zinc-800" />
          </div>
        ))}
      </div>
    </div>
  );
}
