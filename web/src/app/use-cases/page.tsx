import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Use Cases — SpawnForge',
  description:
    'Discover how to use SpawnForge for platformers, RPGs, puzzle games, game jams, and education.',
  alternates: { canonical: '/use-cases' },
  openGraph: {
    title: 'SpawnForge Use Cases',
    description:
      'From platformers to game jams to classroom projects — see what you can build with SpawnForge.',
  },
};

const useCases = [
  {
    slug: 'platformer',
    name: 'Platformer Games',
    tagline: 'Side-scrollers, precision platformers, and metroidvanias',
    icon: '🎮',
  },
  {
    slug: 'rpg',
    name: 'RPG & Adventure',
    tagline: 'Story-driven worlds with quests, NPCs, and inventory systems',
    icon: '⚔️',
  },
  {
    slug: 'puzzle-game',
    name: 'Puzzle Games',
    tagline: 'Logic puzzles, match games, and brain teasers',
    icon: '🧩',
  },
  {
    slug: 'game-jam',
    name: 'Game Jams',
    tagline: 'Go from idea to playable game in hours, not days',
    icon: '⏱️',
  },
  {
    slug: 'education',
    name: 'Education',
    tagline: 'Teach game development and programming concepts in the browser',
    icon: '🎓',
  },
] as const;

export default async function UseCasesPage() {
  'use cache';
  cacheLife('days');
  cacheTag('use-cases');

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="mb-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
        Use Cases
      </h1>
      <p className="mb-12 max-w-2xl text-lg text-zinc-300">
        SpawnForge adapts to any game type or creative workflow. Explore how
        teams and individuals use the platform.
      </p>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {useCases.map((uc) => (
          <Link
            key={uc.slug}
            href={`/use-cases/${uc.slug}`}
            className="group rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 transition-colors hover:border-orange-500/50 hover:bg-zinc-900"
          >
            <span className="mb-3 block text-2xl">{uc.icon}</span>
            <h2 className="text-lg font-semibold text-white group-hover:text-orange-400">
              {uc.name}
            </h2>
            <p className="mt-2 text-sm text-zinc-400">{uc.tagline}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
