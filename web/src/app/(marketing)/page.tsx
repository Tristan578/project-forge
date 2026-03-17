import Link from 'next/link';
import {
  Bot,
  Blocks,
  Cpu,
  Code2,
  Globe,
  Users,
  Sparkles,
  Paintbrush,
  Rocket,
  ArrowRight,
  Check,
  Minus,
  Zap,
  Shield,
  Gamepad2,
} from 'lucide-react';

/* ------------------------------------------------------------------ */
/*  Data                                                               */
/* ------------------------------------------------------------------ */

const features = [
  {
    icon: Bot,
    title: 'AI Game Studio',
    description:
      'Multi-agent AI creates entire games from a single prompt. Describe your vision and watch it come to life.',
  },
  {
    icon: Blocks,
    title: '327+ MCP Commands',
    description:
      'The most comprehensive AI-game integration available. Every engine capability is AI-accessible.',
  },
  {
    icon: Cpu,
    title: 'Bevy Engine (WebGPU)',
    description:
      'Production-grade Rust engine compiled to WASM. WebGPU primary with WebGL2 fallback for maximum compatibility.',
  },
  {
    icon: Code2,
    title: 'Visual Scripting + TypeScript',
    description:
      '73 node types for visual scripting, or write TypeScript directly. Full forge.* API for game logic.',
  },
  {
    icon: Globe,
    title: 'One-Click Publish',
    description:
      'Publish your game to a shareable URL instantly. No build tools, no deployment pipelines, no servers.',
  },
  {
    icon: Users,
    title: 'Real-Time Collaboration',
    description:
      'Work together on games in real time. Coming soon with full multiplayer editing support.',
    badge: 'Coming Soon',
  },
  {
    icon: Gamepad2,
    title: '2D & 3D Game Support',
    description:
      'Full 2D engine with tilemaps, sprites, and physics. Full 3D with PBR materials, skeletal animation, and particles.',
  },
  {
    icon: Shield,
    title: 'Secure by Default',
    description:
      'Sandboxed script execution, CSP headers, rate limiting, and encrypted API keys. Enterprise-grade security.',
  },
] as const;

const steps = [
  {
    number: '1',
    icon: Sparkles,
    title: 'Describe',
    description: 'Tell the AI what game you want to create using natural language.',
  },
  {
    number: '2',
    icon: Paintbrush,
    title: 'Create',
    description:
      'AI agents build your scene, add physics, scripting, and game logic automatically.',
  },
  {
    number: '3',
    icon: Rocket,
    title: 'Publish',
    description: 'One click to publish. Share your game with the world via a unique URL.',
  },
] as const;

interface ComparisonRow {
  feature: string;
  spawnforge: string | boolean;
  unity: string | boolean;
  godot: string | boolean;
  gamemaker: string | boolean;
}

const comparisonData: ComparisonRow[] = [
  {
    feature: 'Browser-native (no install)',
    spawnforge: true,
    unity: false,
    godot: false,
    gamemaker: false,
  },
  {
    feature: 'AI-first game creation',
    spawnforge: true,
    unity: false,
    godot: false,
    gamemaker: false,
  },
  {
    feature: 'Free tier available',
    spawnforge: true,
    unity: true,
    godot: true,
    gamemaker: false,
  },
  {
    feature: 'Visual scripting',
    spawnforge: true,
    unity: true,
    godot: true,
    gamemaker: true,
  },
  {
    feature: 'WebGPU rendering',
    spawnforge: true,
    unity: false,
    godot: 'Partial',
    gamemaker: false,
  },
  {
    feature: '2D + 3D support',
    spawnforge: true,
    unity: true,
    godot: true,
    gamemaker: '2D only',
  },
  {
    feature: 'One-click web publish',
    spawnforge: true,
    unity: false,
    godot: false,
    gamemaker: false,
  },
  {
    feature: 'TypeScript scripting',
    spawnforge: true,
    unity: false,
    godot: false,
    gamemaker: false,
  },
];

const competitors = ['SpawnForge', 'Unity', 'Godot', 'GameMaker'] as const;

interface PricingTier {
  name: string;
  price: string;
  period: string;
  description: string;
  features: string[];
  cta: string;
  highlighted: boolean;
}

const pricingTiers: PricingTier[] = [
  {
    name: 'Starter',
    price: '$9',
    period: '/month',
    description: 'For hobbyists getting started with game creation.',
    features: [
      'AI chat (limited)',
      '3 published games',
      'Community templates',
      'Basic export',
    ],
    cta: 'Get Started',
    highlighted: false,
  },
  {
    name: 'Hobbyist',
    price: '$19',
    period: '/month',
    description: 'For serious hobbyists building their portfolio.',
    features: [
      'Everything in Starter',
      'Unlimited AI chat',
      '10 published games',
      'Asset generation',
      'Priority support',
    ],
    cta: 'Get Started',
    highlighted: false,
  },
  {
    name: 'Creator',
    price: '$29',
    period: '/month',
    description: 'For indie developers shipping real games.',
    features: [
      'Everything in Hobbyist',
      'Unlimited published games',
      'Custom domain',
      'Advanced AI tools',
      'Remove branding',
    ],
    cta: 'Start Creating',
    highlighted: true,
  },
  {
    name: 'Studio',
    price: '$79',
    period: '/month',
    description: 'For teams and studios building at scale.',
    features: [
      'Everything in Creator',
      'Team collaboration',
      'API access',
      'Dedicated support',
      'Custom integrations',
    ],
    cta: 'Contact Us',
    highlighted: false,
  },
];

const navLinks = [
  { href: '#features', label: 'Features' },
  { href: '#how-it-works', label: 'How It Works' },
  { href: '#compare', label: 'Compare' },
  { href: '#pricing', label: 'Pricing' },
] as const;

/* ------------------------------------------------------------------ */
/*  Page                                                               */
/* ------------------------------------------------------------------ */

export default function LandingPage() {
  return (
    <>
      {/* ---- Navigation ---- */}
      <nav
        className="sticky top-0 z-50 border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md"
        aria-label="Main navigation"
      >
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <Link href="/" className="text-xl font-bold text-white">
            SpawnForge
          </Link>
          <div className="hidden items-center gap-8 md:flex">
            {navLinks.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="text-sm text-zinc-400 transition-colors hover:text-white"
              >
                {link.label}
              </a>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/sign-in"
              className="text-sm text-zinc-400 transition-colors hover:text-white"
            >
              Sign In
            </Link>
            <Link
              href="/sign-up"
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
            >
              Start Creating Free
            </Link>
          </div>
        </div>
      </nav>

      {/* ---- Hero ---- */}
      <section className="relative overflow-hidden px-6 py-24 sm:py-32 lg:py-40">
        {/* Gradient background */}
        <div
          className="pointer-events-none absolute inset-0 bg-gradient-to-b from-blue-600/10 via-transparent to-transparent"
          aria-hidden="true"
        />
        <div className="relative mx-auto max-w-4xl text-center">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-zinc-700 bg-zinc-900 px-4 py-1.5 text-sm text-zinc-300">
            <Zap className="h-4 w-4 text-blue-400" aria-hidden="true" />
            AI-Native Game Engine
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-white sm:text-6xl lg:text-7xl">
            Create Games with AI
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-zinc-400 sm:text-xl">
            The browser-based 2D/3D game engine powered by AI. No downloads, no
            installs. Describe your game in plain English and watch it come to
            life.
          </p>
          <div className="mt-10 flex flex-col items-center justify-center gap-4 sm:flex-row">
            <Link
              href="/sign-up"
              className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-3 text-base font-semibold text-white transition-colors hover:bg-blue-500"
            >
              Start Creating Free
              <ArrowRight className="h-4 w-4" aria-hidden="true" />
            </Link>
            <a
              href="#how-it-works"
              className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-6 py-3 text-base font-semibold text-zinc-300 transition-colors hover:border-zinc-500 hover:text-white"
            >
              See How It Works
            </a>
          </div>
        </div>
      </section>

      {/* ---- Features ---- */}
      <section id="features" className="px-6 py-20" aria-labelledby="features-heading">
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <h2
              id="features-heading"
              className="text-3xl font-bold text-white sm:text-4xl"
            >
              Everything You Need to Build Games
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-zinc-400">
              A complete game creation platform with AI at its core. From concept
              to published game in minutes.
            </p>
          </div>
          <div className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {features.map((f) => (
              <div
                key={f.title}
                className="group relative rounded-xl border border-zinc-800 bg-zinc-900/50 p-6 transition-colors hover:border-zinc-700"
              >
                <div className="mb-4 inline-flex rounded-lg bg-blue-600/10 p-3">
                  <f.icon
                    className="h-6 w-6 text-blue-400"
                    aria-hidden="true"
                  />
                </div>
                <h3 className="mb-2 text-lg font-semibold text-white">
                  {f.title}
                  {'badge' in f && f.badge && (
                    <span className="ml-2 inline-block rounded-full bg-zinc-800 px-2 py-0.5 text-xs font-normal text-zinc-400">
                      {f.badge}
                    </span>
                  )}
                </h3>
                <p className="text-sm leading-relaxed text-zinc-400">
                  {f.description}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- How It Works ---- */}
      <section
        id="how-it-works"
        className="border-y border-zinc-800 bg-zinc-900/30 px-6 py-20"
        aria-labelledby="how-it-works-heading"
      >
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2
              id="how-it-works-heading"
              className="text-3xl font-bold text-white sm:text-4xl"
            >
              Three Steps to Your Game
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-zinc-400">
              From idea to published game in minutes, not months.
            </p>
          </div>
          <div className="mt-16 grid gap-8 md:grid-cols-3">
            {steps.map((step) => (
              <div key={step.number} className="text-center">
                <div className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-blue-600/10">
                  <step.icon
                    className="h-8 w-8 text-blue-400"
                    aria-hidden="true"
                  />
                </div>
                <div className="mb-2 text-sm font-medium text-blue-400">
                  Step {step.number}
                </div>
                <h3 className="mb-2 text-xl font-semibold text-white">
                  {step.title}
                </h3>
                <p className="text-zinc-400">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Comparison Table ---- */}
      <section id="compare" className="px-6 py-20" aria-labelledby="compare-heading">
        <div className="mx-auto max-w-5xl">
          <div className="text-center">
            <h2
              id="compare-heading"
              className="text-3xl font-bold text-white sm:text-4xl"
            >
              How SpawnForge Compares
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-zinc-400">
              See how SpawnForge stacks up against traditional game engines.
            </p>
          </div>
          <div className="mt-12 overflow-x-auto">
            <table className="w-full border-collapse" role="table">
              <thead>
                <tr className="border-b border-zinc-800">
                  <th className="pb-4 pr-4 text-left text-sm font-medium text-zinc-400">
                    Feature
                  </th>
                  {competitors.map((name) => (
                    <th
                      key={name}
                      className={`pb-4 text-center text-sm font-medium ${
                        name === 'SpawnForge' ? 'text-blue-400' : 'text-zinc-400'
                      }`}
                    >
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {comparisonData.map((row) => (
                  <tr
                    key={row.feature}
                    className="border-b border-zinc-800/50"
                  >
                    <td className="py-3 pr-4 text-sm text-zinc-300">
                      {row.feature}
                    </td>
                    {(['spawnforge', 'unity', 'godot', 'gamemaker'] as const).map(
                      (engine) => {
                        const value = row[engine];
                        return (
                          <td key={engine} className="py-3 text-center">
                            {value === true ? (
                              <Check
                                className="mx-auto h-5 w-5 text-emerald-400"
                                aria-label="Yes"
                              />
                            ) : value === false ? (
                              <Minus
                                className="mx-auto h-5 w-5 text-zinc-600"
                                aria-label="No"
                              />
                            ) : (
                              <span className="text-sm text-zinc-400">{value}</span>
                            )}
                          </td>
                        );
                      }
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ---- Pricing ---- */}
      <section
        id="pricing"
        className="border-y border-zinc-800 bg-zinc-900/30 px-6 py-20"
        aria-labelledby="pricing-heading"
      >
        <div className="mx-auto max-w-7xl">
          <div className="text-center">
            <h2
              id="pricing-heading"
              className="text-3xl font-bold text-white sm:text-4xl"
            >
              Simple, Transparent Pricing
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-zinc-400">
              Start free, scale as you grow. No hidden fees.
            </p>
          </div>
          <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {pricingTiers.map((tier) => (
              <div
                key={tier.name}
                className={`flex flex-col rounded-xl border p-6 ${
                  tier.highlighted
                    ? 'border-blue-500 bg-blue-600/5'
                    : 'border-zinc-800 bg-zinc-900/50'
                }`}
              >
                {tier.highlighted && (
                  <div className="mb-4 text-xs font-semibold uppercase tracking-wide text-blue-400">
                    Most Popular
                  </div>
                )}
                <h3 className="text-lg font-semibold text-white">{tier.name}</h3>
                <div className="mt-2 flex items-baseline gap-1">
                  <span className="text-3xl font-bold text-white">
                    {tier.price}
                  </span>
                  <span className="text-sm text-zinc-400">{tier.period}</span>
                </div>
                <p className="mt-2 text-sm text-zinc-400">{tier.description}</p>
                <ul className="mt-6 flex-1 space-y-3" role="list">
                  {tier.features.map((feat) => (
                    <li
                      key={feat}
                      className="flex items-start gap-2 text-sm text-zinc-300"
                    >
                      <Check
                        className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400"
                        aria-hidden="true"
                      />
                      {feat}
                    </li>
                  ))}
                </ul>
                <Link
                  href="/sign-up"
                  className={`mt-6 block rounded-lg px-4 py-2.5 text-center text-sm font-semibold transition-colors ${
                    tier.highlighted
                      ? 'bg-blue-600 text-white hover:bg-blue-500'
                      : 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 hover:text-white'
                  }`}
                >
                  {tier.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Social Proof (placeholder) ---- */}
      <section className="px-6 py-20" aria-labelledby="testimonials-heading">
        <div className="mx-auto max-w-5xl text-center">
          <h2
            id="testimonials-heading"
            className="text-3xl font-bold text-white sm:text-4xl"
          >
            Trusted by Game Creators
          </h2>
          <p className="mx-auto mt-4 max-w-2xl text-zinc-400">
            Join thousands of creators building games with SpawnForge.
          </p>
          <div className="mt-12 grid gap-6 md:grid-cols-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-6"
              >
                <p className="italic text-zinc-400">
                  &ldquo;Testimonial placeholder — real quotes coming
                  soon.&rdquo;
                </p>
                <div className="mt-4 text-sm font-medium text-zinc-500">
                  Creator {i}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- Footer CTA ---- */}
      <section className="border-t border-zinc-800 bg-zinc-900/30 px-6 py-20">
        <div className="mx-auto max-w-3xl text-center">
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Ready to Build Your Game?
          </h2>
          <p className="mt-4 text-lg text-zinc-400">
            Join SpawnForge and start creating games with AI today. No credit
            card required.
          </p>
          <Link
            href="/sign-up"
            className="mt-8 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-8 py-3 text-base font-semibold text-white transition-colors hover:bg-blue-500"
          >
            Start Creating Free
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer className="border-t border-zinc-800 px-6 py-8">
        <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-4 sm:flex-row">
          <div className="text-sm text-zinc-500">SpawnForge</div>
          <div className="flex items-center gap-6 text-sm text-zinc-500">
            <Link href="/pricing" className="hover:text-zinc-300">
              Pricing
            </Link>
            <Link href="/docs" className="hover:text-zinc-300">
              Docs
            </Link>
            <Link href="/terms" className="hover:text-zinc-300">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-zinc-300">
              Privacy
            </Link>
          </div>
        </div>
      </footer>
    </>
  );
}
