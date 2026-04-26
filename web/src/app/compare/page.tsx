import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Compare SpawnForge — SpawnForge',
  description: 'See how SpawnForge compares to Unity, Godot, GameMaker, and Rosebud AI for browser-based game creation.',
  alternates: { canonical: '/compare' },
  openGraph: {
    title: 'Compare SpawnForge to Other Game Engines',
    description: 'Feature-by-feature comparison: SpawnForge vs Unity, Godot, GameMaker, and Rosebud AI.',
  },
};

const competitors = [
  {
    slug: 'unity',
    name: 'Unity',
    tagline: 'Browser-native AI creation vs desktop C# development',
  },
  {
    slug: 'godot',
    name: 'Godot',
    tagline: 'AI-first web engine vs open-source GDScript editor',
  },
  {
    slug: 'gamemaker',
    name: 'GameMaker',
    tagline: 'Full 2D+3D web engine vs 2D-focused desktop tool',
  },
  {
    slug: 'rosebud',
    name: 'Rosebud AI',
    tagline: 'Production engine with MCP commands vs AI code generator',
  },
] as const;

export default async function ComparePage() {
  'use cache';
  cacheLife('days');
  cacheTag('compare');

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="mb-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
        Compare SpawnForge
      </h1>
      <p className="mb-12 max-w-2xl text-lg text-zinc-300">
        See how SpawnForge stacks up against traditional and AI-powered game engines.
      </p>
      <div className="grid gap-6 sm:grid-cols-2">
        {competitors.map((comp) => (
          <Link
            key={comp.slug}
            href={`/compare/${comp.slug}`}
            className="group rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 transition-colors hover:border-orange-500/50 hover:bg-zinc-900"
          >
            <h2 className="text-xl font-semibold text-white group-hover:text-orange-400">
              SpawnForge vs {comp.name}
            </h2>
            <p className="mt-2 text-sm text-zinc-400">{comp.tagline}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
