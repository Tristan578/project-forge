import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import Link from 'next/link';
import { notFound } from 'next/navigation';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://spawnforge.ai';

interface FeatureRow {
  feature: string;
  spawnforge: string;
  competitor: string;
}

interface CompetitorData {
  name: string;
  slug: string;
  description: string;
  positioning: string;
  features: FeatureRow[];
}

const competitors: Record<string, CompetitorData> = {
  unity: {
    name: 'Unity',
    slug: 'unity',
    description:
      'Compare SpawnForge to Unity for browser-based game development. See how AI-native web creation stacks up against desktop C# development.',
    positioning:
      'Unity is an industry-standard desktop game engine requiring C# expertise and complex build pipelines for WebGL export. SpawnForge is a browser-native engine where you create games with natural language or visual editing — no install, no compile step, instant preview.',
    features: [
      { feature: 'Setup', spawnforge: 'Open browser, start creating', competitor: 'Download installer, create project, configure build settings' },
      { feature: 'Language', spawnforge: 'Natural language + visual scripting', competitor: 'C# (Unity-specific APIs)' },
      { feature: 'Web Export', spawnforge: 'Native — games run in browser by default', competitor: 'WebGL build target (large bundles, long compile)' },
      { feature: 'AI Assistance', spawnforge: '25+ AI modules, 350 MCP commands', competitor: 'Unity Muse (limited, separate subscription)' },
      { feature: 'Rendering', spawnforge: 'WebGPU + WebGL2 auto-detect', competitor: 'WebGL 2.0 (no WebGPU export)' },
      { feature: 'Physics', spawnforge: 'Built-in 2D + 3D (Rapier)', competitor: 'PhysX (3D), Box2D (2D)' },
      { feature: 'Pricing', spawnforge: 'Free tier available, $9-$99/mo', competitor: 'Free tier, $399-$2040/yr for pro features' },
      { feature: 'Collaboration', spawnforge: 'Browser-based, share via URL', competitor: 'Desktop-only, requires version control setup' },
      { feature: 'Learning Curve', spawnforge: 'Minutes to first game', competitor: 'Weeks to months for proficiency' },
      { feature: 'Publish', spawnforge: 'One-click publish to spawnforge.ai', competitor: 'Manual hosting or platform-specific submission' },
    ],
  },
  godot: {
    name: 'Godot',
    slug: 'godot',
    description:
      'Compare SpawnForge to Godot for game development. See how an AI-first web engine compares to the open-source GDScript editor.',
    positioning:
      'Godot is a beloved open-source desktop engine with its own GDScript language and node-based scene system. SpawnForge takes a different approach — everything runs in the browser with AI-powered creation, so you describe what you want instead of writing code from scratch.',
    features: [
      { feature: 'Setup', spawnforge: 'Open browser, start creating', competitor: 'Download desktop app, learn node system' },
      { feature: 'Language', spawnforge: 'Natural language + visual scripting (73 nodes)', competitor: 'GDScript, C#, or GDExtension (C++)' },
      { feature: 'Web Export', spawnforge: 'Native — browser-first engine', competitor: 'HTML5 export (experimental, large binary)' },
      { feature: 'AI Assistance', spawnforge: '25+ AI modules integrated in editor', competitor: 'No built-in AI features' },
      { feature: 'Rendering', spawnforge: 'WebGPU + WebGL2', competitor: 'Vulkan, OpenGL, software renderer' },
      { feature: 'Physics', spawnforge: 'Rapier 2D + 3D', competitor: 'Godot Physics or Jolt (3D)' },
      { feature: 'Pricing', spawnforge: 'Free tier, $9-$99/mo for more', competitor: 'Completely free and open source' },
      { feature: 'Scene System', spawnforge: 'Hierarchy + AI-managed components', competitor: 'Node tree with inheritance' },
      { feature: 'Asset Pipeline', spawnforge: 'AI texture/model generation', competitor: 'Manual import workflow' },
      { feature: 'Community', spawnforge: 'Built-in game gallery + sharing', competitor: 'Asset Library, forums, Discord' },
    ],
  },
  gamemaker: {
    name: 'GameMaker',
    slug: 'gamemaker',
    description:
      'Compare SpawnForge to GameMaker for 2D and 3D game creation. See how a full web engine with AI compares to a 2D-focused desktop tool.',
    positioning:
      'GameMaker has a long history as a 2D game creation tool with its own GML language. SpawnForge offers both 2D and 3D creation in the browser with AI assistance — no download needed, and you can go from idea to published game without writing code.',
    features: [
      { feature: 'Setup', spawnforge: 'Open browser, start creating', competitor: 'Download installer, purchase license' },
      { feature: 'Dimensions', spawnforge: 'Full 2D + 3D engine', competitor: 'Primarily 2D (limited 3D support)' },
      { feature: 'Language', spawnforge: 'Natural language + visual scripting', competitor: 'GML (GameMaker Language)' },
      { feature: 'Web Export', spawnforge: 'Native browser engine', competitor: 'HTML5 export (paid tier required)' },
      { feature: 'AI Assistance', spawnforge: '25+ AI modules, asset generation', competitor: 'No built-in AI' },
      { feature: 'Rendering', spawnforge: 'WebGPU + WebGL2', competitor: 'OpenGL (desktop), WebGL (export)' },
      { feature: 'Pricing', spawnforge: 'Free tier available', competitor: 'Free tier, $9.99/mo for exports' },
      { feature: 'Tilemap Editor', spawnforge: 'Built-in with AI placement', competitor: 'Built-in room editor' },
      { feature: 'Sprite Tools', spawnforge: 'AI pixel art generation', competitor: 'Built-in sprite editor' },
      { feature: 'Publish', spawnforge: 'One-click web publish', competitor: 'Build + manual upload to platforms' },
    ],
  },
  rosebud: {
    name: 'Rosebud AI',
    slug: 'rosebud',
    description:
      'Compare SpawnForge to Rosebud AI for AI-powered game creation. See how a production engine with MCP commands compares to an AI code generator.',
    positioning:
      'Rosebud AI generates simple browser games from text prompts, outputting raw HTML/JS code. SpawnForge is a full production engine — you get a visual editor, physics, audio, particles, skeletal animation, and 350 MCP commands for AI-driven workflows, not just generated code.',
    features: [
      { feature: 'Engine', spawnforge: 'Full Bevy/WASM engine (WebGPU)', competitor: 'Generated HTML5/JavaScript' },
      { feature: 'AI Approach', spawnforge: 'AI assists within a real engine', competitor: 'AI generates entire game code' },
      { feature: 'Visual Editor', spawnforge: 'Full scene hierarchy, inspectors, viewport', competitor: 'Code-only output' },
      { feature: 'Physics', spawnforge: 'Rapier 2D + 3D with inspector', competitor: 'Basic collision (code-generated)' },
      { feature: 'Audio', spawnforge: 'Spatial audio, mixer, bus system', competitor: 'Basic audio playback' },
      { feature: 'Particles', spawnforge: 'GPU particles (WebGPU), 9 presets', competitor: 'CSS/Canvas-based effects' },
      { feature: 'MCP Integration', spawnforge: '350 commands across 41 categories', competitor: 'No MCP support' },
      { feature: 'Animation', spawnforge: 'Skeletal + GLTF + keyframe', competitor: 'CSS/JS animations' },
      { feature: 'Customization', spawnforge: 'Edit AI output in visual editor', competitor: 'Edit generated source code' },
      { feature: 'Scalability', spawnforge: 'Complex 3D scenes, ECS architecture', competitor: 'Simple 2D games' },
    ],
  },
};

const validSlugs = Object.keys(competitors);

export function generateStaticParams() {
  return validSlugs.map((slug) => ({ competitor: slug }));
}

interface ComparePageProps {
  params: Promise<{ competitor: string }>;
}

export async function generateMetadata({ params }: ComparePageProps): Promise<Metadata> {
  const { competitor: slug } = await params;
  const comp = competitors[slug];
  if (!comp) return { title: 'Not Found — SpawnForge' };

  return {
    title: `SpawnForge vs ${comp.name} — SpawnForge`,
    description: comp.description,
    alternates: { canonical: `/compare/${slug}` },
    openGraph: {
      title: `SpawnForge vs ${comp.name}`,
      description: comp.description,
    },
  };
}

export default async function CompetitorComparePage({ params }: ComparePageProps) {
  'use cache';
  cacheLife('days');
  cacheTag('compare');

  const { competitor: slug } = await params;
  const comp = competitors[slug];
  if (!comp) notFound();

  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: `SpawnForge vs ${comp.name}`,
    description: comp.description,
    url: `${SITE_URL}/compare/${slug}`,
    about: [
      {
        '@type': 'SoftwareApplication',
        name: 'SpawnForge',
        applicationCategory: 'GameApplication',
        operatingSystem: 'Web Browser',
      },
      {
        '@type': 'SoftwareApplication',
        name: comp.name,
        applicationCategory: 'GameApplication',
      },
    ],
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <Link
          href="/compare"
          className="mb-8 inline-flex items-center text-sm text-zinc-400 hover:text-orange-400"
        >
          &larr; All comparisons
        </Link>

        <h1 className="mb-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          SpawnForge vs {comp.name}
        </h1>
        <p className="mb-12 max-w-2xl text-lg text-zinc-300">{comp.positioning}</p>

        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-zinc-800 bg-zinc-900">
                <th className="px-4 py-3 font-medium text-zinc-400">Feature</th>
                <th className="px-4 py-3 font-medium text-orange-400">SpawnForge</th>
                <th className="px-4 py-3 font-medium text-zinc-400">{comp.name}</th>
              </tr>
            </thead>
            <tbody>
              {comp.features.map((row) => (
                <tr key={row.feature} className="border-b border-zinc-800/50">
                  <td className="px-4 py-3 font-medium text-white">{row.feature}</td>
                  <td className="px-4 py-3 text-zinc-300">{row.spawnforge}</td>
                  <td className="px-4 py-3 text-zinc-400">{row.competitor}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-12 rounded-lg border border-orange-500/20 bg-orange-500/5 p-8 text-center">
          <h2 className="mb-2 text-xl font-semibold text-white">
            Ready to try SpawnForge?
          </h2>
          <p className="mb-6 text-zinc-300">
            Create your first game in minutes — no download, no setup.
          </p>
          <Link
            href="/sign-up"
            className="inline-flex rounded-lg bg-orange-500 px-6 py-3 font-medium text-white transition-colors hover:bg-orange-600"
          >
            Get Started Free
          </Link>
        </div>
      </div>
    </>
  );
}
