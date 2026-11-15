export function PreLaunchBanner() {
  return (
    <aside
      aria-label="Pre-launch notice"
      className="border-b border-blue-800/60 bg-blue-950 px-4 py-2 text-center text-sm text-blue-100"
    >
      <span className="font-semibold text-white">Private pre-launch:</span>{' '}
      Features described here are planned or in active development. Join the waitlist for launch access.
    </aside>
  );
}
