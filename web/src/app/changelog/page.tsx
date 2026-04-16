import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { readChangelog } from '@/lib/changelog';

export const metadata: Metadata = {
  title: 'Changelog — SpawnForge',
  description:
    'See what has changed in SpawnForge — new features, fixes, and improvements.',
  alternates: { canonical: '/changelog' },
  openGraph: {
    title: 'SpawnForge Changelog',
    description: 'Track every SpawnForge release — features, fixes, and improvements.',
  },
};

function renderContent(lines: string[]) {
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let subheading: string | null = null;

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`list-${elements.length}`} className="mb-4 list-disc space-y-1 pl-6 text-zinc-300">
          {listItems.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
      listItems = [];
    }
  };

  for (const line of lines) {
    if (line.startsWith('### ')) {
      flushList();
      subheading = line.replace('### ', '');
      elements.push(
        <h3 key={`h3-${elements.length}`} className="mb-2 mt-4 text-sm font-semibold uppercase tracking-wider text-orange-400">
          {subheading}
        </h3>
      );
    } else if (line.startsWith('- ')) {
      const text = line.replace(/^- \*\*(.*?)\*\*:?\s*/, '$1: ').replace(/^- /, '');
      listItems.push(text);
    } else if (line.trim() === '') {
      flushList();
    }
  }
  flushList();
  return elements;
}

export default async function ChangelogPage() {
  'use cache';
  cacheLife('days');
  cacheTag('changelog');

  const sections = readChangelog();

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="mb-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
        Changelog
      </h1>
      <p className="mb-12 text-lg text-zinc-300">
        Track every SpawnForge release — features, fixes, and improvements.
      </p>

      {sections.length === 0 ? (
        <p className="text-zinc-400">No changelog entries yet.</p>
      ) : (
        <div className="space-y-10">
          {sections.map((section) => (
            <div key={section.heading} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
              <h2 className="mb-4 text-xl font-semibold text-white">
                {section.heading}
              </h2>
              {renderContent(section.content)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
