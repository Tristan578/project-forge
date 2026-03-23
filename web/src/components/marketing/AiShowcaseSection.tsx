import { MessageSquare, Sparkles } from 'lucide-react';

interface ShowcaseExample {
  prompt: string;
  label: string;
  gradientFrom: string;
  gradientTo: string;
  accentColor: string;
  elements: string[];
}

const examples: ShowcaseExample[] = [
  {
    prompt: 'Create a side-scrolling platformer with a pixel-art knight character, moving platforms, and collectible coins.',
    label: 'Platformer',
    gradientFrom: 'from-blue-900/60',
    gradientTo: 'to-indigo-900/40',
    accentColor: 'bg-yellow-400/80',
    elements: ['Platform', 'Knight', 'Coin x3'],
  },
  {
    prompt: 'Build a top-down space shooter with asteroids, laser weapons, and escalating waves of enemies.',
    label: 'Space Shooter',
    gradientFrom: 'from-violet-900/60',
    gradientTo: 'to-purple-900/40',
    accentColor: 'bg-violet-400/80',
    elements: ['Ship', 'Asteroid', 'Laser', 'Enemy'],
  },
  {
    prompt: 'Make a puzzle game where players rotate tiles to connect pipes and route water to flowers.',
    label: 'Puzzle',
    gradientFrom: 'from-emerald-900/60',
    gradientTo: 'to-teal-900/40',
    accentColor: 'bg-emerald-400/80',
    elements: ['Pipe', 'Tile Grid', 'Flower'],
  },
];

function GameMockup({ example }: { example: ShowcaseExample }) {
  return (
    <div
      className={`relative h-36 overflow-hidden rounded-lg bg-gradient-to-br ${example.gradientFrom} ${example.gradientTo} border border-zinc-700/50`}
      aria-label={`${example.label} game preview`}
    >
      {/* Scanline overlay for game-like feel */}
      <div
        className="pointer-events-none absolute inset-0 opacity-5"
        style={{
          backgroundImage:
            'repeating-linear-gradient(0deg, #000 0px, #000 1px, transparent 1px, transparent 4px)',
        }}
        aria-hidden="true"
      />
      {/* Game label badge */}
      <div className="absolute left-3 top-3">
        <span className="rounded bg-black/50 px-2 py-0.5 font-mono text-xs text-zinc-300">
          {example.label}
        </span>
      </div>
      {/* Element pills */}
      <div className="absolute bottom-3 left-3 flex flex-wrap gap-1">
        {example.elements.map((el) => (
          <span
            key={el}
            className="rounded bg-black/40 px-1.5 py-0.5 font-mono text-xs text-zinc-400"
          >
            {el}
          </span>
        ))}
      </div>
      {/* Accent dot representing active entity */}
      <div
        className={`absolute right-4 top-1/2 h-3 w-3 -translate-y-1/2 rounded-full ${example.accentColor} ring-2 ring-white/20`}
        aria-hidden="true"
      />
    </div>
  );
}

export function AiShowcaseSection() {
  return (
    <section
      id="demo"
      className="px-6 py-20"
      aria-labelledby="ai-showcase-heading"
    >
      <div className="mx-auto max-w-6xl">
        <div className="text-center">
          <h2
            id="ai-showcase-heading"
            className="text-3xl font-bold text-white sm:text-4xl"
          >
            From Prompt to Playable
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-zinc-400">
            Describe your game in plain English. SpawnForge&apos;s AI generates
            the scene, physics, scripting, and game logic — all in seconds.
          </p>
        </div>

        <div className="mt-16 space-y-8">
          {examples.map((example, idx) => (
            <div
              key={example.label}
              className={`flex flex-col gap-6 lg:flex-row lg:items-center ${
                idx % 2 !== 0 ? 'lg:flex-row-reverse' : ''
              }`}
            >
              {/* Prompt panel */}
              <div className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-6">
                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-7 w-7 items-center justify-center rounded-full bg-blue-600/20">
                    <MessageSquare
                      className="h-3.5 w-3.5 text-blue-400"
                      aria-hidden="true"
                    />
                  </div>
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    User Prompt
                  </span>
                </div>
                <p className="text-sm leading-relaxed text-zinc-200">
                  &ldquo;{example.prompt}&rdquo;
                </p>
                <div className="mt-4 flex items-center gap-2 text-xs text-blue-400">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Generating scene...</span>
                </div>
              </div>

              {/* Arrow connector (hidden on mobile) */}
              <div
                className="hidden shrink-0 text-zinc-600 lg:block"
                aria-hidden="true"
              >
                <svg
                  width="32"
                  height="32"
                  viewBox="0 0 32 32"
                  fill="none"
                  className={idx % 2 !== 0 ? 'rotate-180' : ''}
                >
                  <path
                    d="M6 16h20M20 10l6 6-6 6"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>

              {/* Game mockup panel */}
              <div className="flex-1 rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Generated Game
                  </span>
                </div>
                <GameMockup example={example} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
