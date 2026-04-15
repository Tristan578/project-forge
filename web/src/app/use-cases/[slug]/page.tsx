import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import Link from 'next/link';
import { notFound } from 'next/navigation';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://spawnforge.ai';

interface UseCaseData {
  name: string;
  slug: string;
  description: string;
  intro: string;
  features: { title: string; text: string }[];
  cta: string;
}

const useCases: Record<string, UseCaseData> = {
  platformer: {
    name: 'Platformer Games',
    slug: 'platformer',
    description:
      'Build platformer games in the browser with AI assistance — side-scrollers, precision platformers, and metroidvanias.',
    intro:
      'SpawnForge gives you everything you need to build platformers directly in the browser. Use the built-in 2D physics, tilemap editor, and AI-powered sprite generation to go from concept to playable game without leaving your browser tab.',
    features: [
      {
        title: '2D Physics',
        text: 'Rapier2D integration with 6 collider shapes, one-way platforms, and surface velocity — tuned for tight platformer feel.',
      },
      {
        title: 'Tilemap Editor',
        text: 'Multi-layer tilemaps with paint, erase, fill, and rectangle tools. AI can place tiles from a description.',
      },
      {
        title: 'Sprite Animation',
        text: 'Sprite sheet slicing, animation clips, and state machines with parameter-driven transitions for run/jump/idle cycles.',
      },
      {
        title: 'Starter Bundle',
        text: 'The Platformer starter bundle pre-configures a side-scroller camera, character controller, and gravity — ready in one click.',
      },
      {
        title: 'AI Pixel Art',
        text: 'Generate pixel art characters, tilesets, and sprite sheets with AI. Describe "a red robot character with idle and run animations" and get assets instantly.',
      },
    ],
    cta: 'Build a platformer in minutes',
  },
  rpg: {
    name: 'RPG & Adventure',
    slug: 'rpg',
    description:
      'Create RPG and adventure games with dialogue systems, quest logic, and AI-generated worlds using SpawnForge.',
    intro:
      'RPGs demand complex interconnected systems — dialogue trees, inventory, quests, NPCs, and world-building. SpawnForge provides purpose-built tools for each layer, and AI orchestration to wire them together.',
    features: [
      {
        title: 'Dialogue System',
        text: 'Visual node editor with 5 node types (text, choice, condition, action, end). Build branching conversations with typewriter display and the forge.dialogue script API.',
      },
      {
        title: 'Game Components',
        text: '12 drag-and-drop behaviors including Health, Collectible, Inventory, and NPC. Configure properties in the inspector without code.',
      },
      {
        title: 'Visual Scripting',
        text: '73 node types across 10 categories. Non-programmers create quest logic, item interactions, and NPC behaviors by connecting visual blocks.',
      },
      {
        title: '3D Worlds',
        text: 'Procedural terrain with noise-based heightmaps, skybox presets, PBR materials, and dynamic lighting for immersive environments.',
      },
      {
        title: 'AI Scene Generation',
        text: 'Describe a scene — "a medieval village with a tavern, blacksmith, and town square" — and AI spawns entities, configures materials, and positions everything.',
      },
    ],
    cta: 'Start building your RPG',
  },
  'puzzle-game': {
    name: 'Puzzle Games',
    slug: 'puzzle-game',
    description:
      'Design puzzle games in the browser with SpawnForge — logic puzzles, match games, and brain teasers with physics and scripting.',
    intro:
      'Puzzle games thrive on precise mechanics and satisfying feedback. SpawnForge offers physics simulation, visual scripting for game logic, and a UI builder for score displays and menus — all in the browser.',
    features: [
      {
        title: 'Physics Simulation',
        text: 'Full 2D and 3D physics with colliders, forces, joints, and collision events. Build physics-based puzzles with realistic behavior.',
      },
      {
        title: 'In-Game UI Builder',
        text: '10 widget types with WYSIWYG editor, data binding, and 7 screen presets. Build score counters, level selectors, and hint systems visually.',
      },
      {
        title: 'TypeScript Scripting',
        text: 'Sandboxed scripting with the forge.* API for custom puzzle logic — timers, state machines, win conditions, and procedural level generation.',
      },
      {
        title: 'Scene Transitions',
        text: 'Fade, wipe, and instant transitions between scenes. Perfect for level-based puzzle progression.',
      },
      {
        title: 'One-Click Publish',
        text: 'Share your puzzle game instantly with a URL. Players load and play directly in the browser — no app store, no download.',
      },
    ],
    cta: 'Design your puzzle game',
  },
  'game-jam': {
    name: 'Game Jams',
    slug: 'game-jam',
    description:
      'SpawnForge is the fastest way to prototype and ship game jam entries — AI asset generation, starter bundles, and instant publish.',
    intro:
      'Game jams reward speed and creativity. SpawnForge removes the setup friction — no install, no compile step, no deployment pipeline. Open your browser, describe your game, and start building. AI generates assets while you focus on mechanics.',
    features: [
      {
        title: 'Zero Setup',
        text: 'Open a URL and start creating. No IDE download, no project configuration, no build system to fight. Your first entity can exist in under 30 seconds.',
      },
      {
        title: 'AI Asset Pipeline',
        text: 'Generate 3D models, textures, sound effects, voice lines, and music through natural language prompts. Skip the asset hunt entirely.',
      },
      {
        title: 'Starter Bundles',
        text: '11 pre-configured system bundles (Platformer, Shooter, Runner, Puzzle, etc.) give you a working game skeleton in one click.',
      },
      {
        title: 'Compound AI Actions',
        text: 'Describe a complete scene and AI executes dozens of operations in one shot — spawning entities, configuring physics, writing scripts, and setting up cameras.',
      },
      {
        title: 'Instant Publish',
        text: 'One-click publish to a shareable URL. Share your jam entry with judges and players immediately. Export as a standalone ZIP for itch.io.',
      },
    ],
    cta: 'Prototype your next jam entry',
  },
  education: {
    name: 'Education',
    slug: 'education',
    description:
      'Teach game development and programming concepts with SpawnForge — browser-based, visual scripting, no install required.',
    intro:
      'SpawnForge is ideal for classrooms and workshops. Students open a URL and start creating — no software to install, no accounts to configure on lab machines. Visual scripting teaches programming concepts without syntax barriers, and AI assistance helps students overcome blocks.',
    features: [
      {
        title: 'No Installation',
        text: 'Everything runs in the browser. Students on Chromebooks, school laptops, or home computers all get the same experience.',
      },
      {
        title: 'Visual Scripting',
        text: '73 node types teach programming concepts (variables, conditions, loops, events) through visual blocks. Students see logic flow without fighting syntax.',
      },
      {
        title: 'AI Assistance',
        text: 'Students describe what they want in plain language and AI generates the code. Stuck students get unstuck without waiting for the teacher.',
      },
      {
        title: 'Progressive Complexity',
        text: 'Start with drag-and-drop game components, move to visual scripting, then transition to TypeScript. Each layer builds on the last.',
      },
      {
        title: 'Shareable Projects',
        text: 'Students publish their games to shareable URLs. Show parents, submit for grading, or host a class game showcase — all from the browser.',
      },
    ],
    cta: 'Try SpawnForge for your classroom',
  },
};

const validSlugs = Object.keys(useCases);

export function generateStaticParams() {
  return validSlugs.map((slug) => ({ slug }));
}

interface UseCasePageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: UseCasePageProps): Promise<Metadata> {
  const { slug } = await params;
  const uc = useCases[slug];
  if (!uc) return { title: 'Not Found — SpawnForge' };

  return {
    title: `${uc.name} — SpawnForge`,
    description: uc.description,
    alternates: { canonical: `/use-cases/${slug}` },
    openGraph: {
      title: `${uc.name} — SpawnForge`,
      description: uc.description,
    },
  };
}

export default async function UseCasePage({ params }: UseCasePageProps) {
  'use cache';
  cacheLife('days');
  cacheTag('use-cases');

  const { slug } = await params;
  const uc = useCases[slug];
  if (!uc) notFound();

  // Static JSON-LD — no user input, safe for injection
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: uc.name,
    description: uc.description,
    url: `${SITE_URL}/use-cases/${slug}`,
    isPartOf: {
      '@type': 'WebSite',
      name: 'SpawnForge',
      url: SITE_URL,
    },
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
        <Link
          href="/use-cases"
          className="mb-8 inline-flex items-center text-sm text-zinc-400 hover:text-orange-400"
        >
          &larr; All use cases
        </Link>

        <h1 className="mb-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
          {uc.name}
        </h1>
        <p className="mb-12 max-w-2xl text-lg text-zinc-300">{uc.intro}</p>

        <div className="space-y-8">
          {uc.features.map((feature) => (
            <div key={feature.title} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6">
              <h2 className="mb-2 text-lg font-semibold text-orange-400">
                {feature.title}
              </h2>
              <p className="text-zinc-300">{feature.text}</p>
            </div>
          ))}
        </div>

        <div className="mt-12 rounded-lg border border-orange-500/20 bg-orange-500/5 p-8 text-center">
          <h2 className="mb-2 text-xl font-semibold text-white">{uc.cta}</h2>
          <p className="mb-6 text-zinc-300">
            No download, no setup — create your first game in minutes.
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
