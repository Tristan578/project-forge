export default function EditorLoading() {
  return (
    <div className="flex h-screen w-full items-center justify-center bg-zinc-950">
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
