'use client';

import { useState, useRef, useEffect } from 'react';
import { Loader2, CheckCircle, XCircle, ChevronDown, Trash2 } from 'lucide-react';
import { useGenerationStore, type GenerationJob } from '@/stores/generationStore';

export function GenerationStatus() {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const jobs = useGenerationStore((s) => s.jobs);
  const clearCompleted = useGenerationStore((s) => s.clearCompleted);
  const removeJob = useGenerationStore((s) => s.removeJob);

  const allJobs = Object.values(jobs);
  const activeJobs = allJobs.filter(
    (j) => j.status === 'pending' || j.status === 'processing' || j.status === 'downloading'
  );
  const recentJobs = allJobs.slice(-5);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  if (activeJobs.length === 0) return null;

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsDropdownOpen(!isDropdownOpen)}
        className="flex items-center gap-2 rounded bg-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-700"
      >
        <Loader2 size={14} className="animate-spin" />
        <span>Generating ({activeJobs.length})</span>
        <ChevronDown size={12} />
      </button>

      {isDropdownOpen && (
        <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded border border-zinc-700 bg-zinc-900 shadow-xl">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-2">
            <span className="text-xs font-semibold text-zinc-400">Generation Jobs</span>
            <button
              onClick={clearCompleted}
              className="text-xs text-zinc-500 hover:text-zinc-300"
              title="Clear completed jobs"
            >
              <Trash2 size={12} />
            </button>
          </div>

          {/* Job list */}
          <div className="max-h-80 overflow-y-auto">
            {recentJobs.length === 0 ? (
              <div className="p-4 text-center text-xs text-zinc-600">No jobs</div>
            ) : (
              <div className="divide-y divide-zinc-800">
                {recentJobs.map((job) => (
                  <JobRow key={job.id} job={job} onRemove={removeJob} />
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function JobRow({ job, onRemove }: { job: GenerationJob; onRemove: (id: string) => void }) {
  const icon =
    job.status === 'completed' ? (
      <CheckCircle size={14} className="text-green-400" />
    ) : job.status === 'failed' ? (
      <XCircle size={14} className="text-red-400" />
    ) : (
      <Loader2 size={14} className="animate-spin text-blue-400" />
    );

  const statusLabel =
    job.status === 'pending'
      ? 'Pending...'
      : job.status === 'processing'
        ? `Processing... ${job.progress}%`
        : job.status === 'downloading'
          ? 'Downloading...'
          : job.status === 'completed'
            ? 'Completed'
            : 'Failed';

  return (
    <div className="flex items-start gap-2 p-3 hover:bg-zinc-800/50">
      <div className="mt-0.5">{icon}</div>
      <div className="flex-1 space-y-1">
        <div className="text-xs font-medium text-zinc-300">{job.type}</div>
        <div className="text-[10px] text-zinc-500">{job.prompt.slice(0, 60)}{job.prompt.length > 60 ? '...' : ''}</div>
        <div className="text-[10px] text-zinc-600">{statusLabel}</div>
        {job.error && <div className="text-[10px] text-red-400">{job.error}</div>}
      </div>
      {(job.status === 'completed' || job.status === 'failed') && (
        <button
          onClick={() => onRemove(job.id)}
          className="text-zinc-600 hover:text-zinc-400"
          title="Remove"
        >
          <XCircle size={12} />
        </button>
      )}
    </div>
  );
}
