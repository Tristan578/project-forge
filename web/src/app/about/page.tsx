import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';

export const metadata: Metadata = {
  title: 'About — SpawnForge',
  description: 'SpawnForge is an AI-native browser-based 2D/3D game creation platform. Rust/WASM engine, WebGPU rendering, 350 MCP commands, visual scripting.',
  alternates: { canonical: '/about' },
  openGraph: {
    title: 'About SpawnForge',
    description: 'AI-native browser-based game engine — Rust/WASM, WebGPU, 350 MCP commands.',
  },
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://spawnforge.ai';

const stats = [
  { label: 'MCP Commands', value: '350', detail: 'across 41 categories' },
  { label: 'Visual Script Nodes', value: '73', detail: 'drag-and-drop logic' },
  { label: 'Material Presets', value: '56', detail: 'PBR materials' },
  { label: 'AI Modules', value: '25+', detail: 'specialized agents' },
] as const;

// Static JSON-LD (safe constant — no user input, no XSS risk)
const aboutJsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'AboutPage',
  mainEntity: {
    '@type': ['WebApplication', 'SoftwareApplication'],
    name: 'SpawnForge',
    url: SITE_URL,
    applicationCategory: ['GameApplication', 'DeveloperApplication'],
    operatingSystem: 'Web Browser',
    description:
      'AI-native browser-based 2D and 3D game creation platform. Rust engine compiled to WASM with WebGPU rendering, 350 MCP commands, and visual scripting.',
  },
});

export default async function AboutPage() {
  'use cache';
  cacheLife('days');
  cacheTag('about');

  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6 lg:px-8">
      {/* JSON-LD structured data — static constant, no user input */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: aboutJsonLd }}
      />

      <h1 className="mb-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
        About SpawnForge
      </h1>
      <p className="mb-12 max-w-2xl text-lg text-zinc-300 leading-relaxed">
        SpawnForge is an AI-native, browser-based game creation platform. Describe your game
        in natural language and watch it come to life — or use the visual editor for
        fine-grained control. No downloads, no installs.
      </p>

      {/* Stats grid */}
      <div className="mb-16 grid grid-cols-2 gap-6 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 text-center">
            <div className="text-3xl font-bold text-white">{stat.value}</div>
            <div className="mt-1 text-sm font-medium text-zinc-300">{stat.label}</div>
            <div className="mt-0.5 text-xs text-zinc-500">{stat.detail}</div>
          </div>
        ))}
      </div>

      {/* Architecture */}
      <section className="mb-12">
        <h2 className="mb-4 text-2xl font-semibold text-white">Architecture</h2>
        <div className="space-y-3 text-zinc-300 leading-relaxed">
          <p>
            <strong className="text-white">Engine:</strong> Built in Rust using the Bevy 0.18 ECS
            framework, compiled to WebAssembly via wasm-bindgen. The engine handles scene
            management, physics (Rapier 3D and 2D), rendering, animation, particles, and audio
            metadata — all at native speed in the browser.
          </p>
          <p>
            <strong className="text-white">Rendering:</strong> WebGPU primary (wgpu 27) with
            automatic WebGL2 fallback. Four binaries — two editor and two runtime variants —
            ensure compatibility across Chrome, Firefox, Safari, and Edge.
          </p>
          <p>
            <strong className="text-white">Editor:</strong> React shell (Next.js 16) with Zustand
            state management and Tailwind CSS. JSON commands flow from the editor to the engine
            via the wasm-bindgen bridge; events flow back through callbacks.
          </p>
          <p>
            <strong className="text-white">AI:</strong> Multi-agent orchestration with 350 MCP
            commands across 41 categories. AI generates 3D models, textures, sound effects,
            music, and voice — then uses MCP commands to place and configure them in the scene.
          </p>
        </div>
      </section>

      {/* Key Capabilities */}
      <section className="mb-12">
        <h2 className="mb-4 text-2xl font-semibold text-white">Key Capabilities</h2>
        <ul className="grid gap-3 text-zinc-300 sm:grid-cols-2">
          <li className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            AI game creation from natural language
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            Full 2D and 3D engine in the browser
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            Visual scripting (73 node types)
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            TypeScript scripting with forge.* API
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            One-click browser game publishing
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            PBR materials (56 presets)
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            Skeletal animation and GPU particles
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            Rapier 3D and 2D physics simulation
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            Tilemap editor and dialogue system
          </li>
          <li className="flex items-start gap-2">
            <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
            Economy designer and leaderboards
          </li>
        </ul>
      </section>

      {/* Positioning */}
      <section>
        <h2 className="mb-4 text-2xl font-semibold text-white">How SpawnForge is Different</h2>
        <div className="space-y-3 text-zinc-300 leading-relaxed">
          <p>
            Traditional game engines like Unity and Godot require desktop installation,
            proprietary scripting languages, and complex build pipelines. SpawnForge runs
            entirely in the browser — you can go from idea to published game without leaving
            your browser tab.
          </p>
          <p>
            Where other tools add AI as an afterthought, SpawnForge was built AI-first. The
            entire engine is controllable through 350 MCP commands, making it the most
            AI-accessible game engine available. AI is not a feature — it is the primary
            creation interface.
          </p>
        </div>
      </section>
    </div>
  );
}
