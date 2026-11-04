import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import {
  getTierPlan,
  countLabel,
  PROJECT_LIMITS,
  PUBLISH_LIMITS,
} from '@/lib/billing/tierPlans';
import { MCP_COMMAND_COUNT, MCP_CATEGORY_COUNT } from '@/lib/mcp/manifestStats';
import { TRIAL_GRANT_TOKENS } from '@/lib/tokens/pricing';
import { currentPublicCapabilities } from '@/lib/config/publicCapabilities';

export const metadata: Metadata = {
  title: 'FAQ — SpawnForge',
  description: 'Frequently asked questions about SpawnForge — the AI-powered browser-based game creation platform.',
  alternates: { canonical: '/faq' },
  openGraph: {
    title: 'FAQ — SpawnForge',
    description: 'Frequently asked questions about SpawnForge.',
  },
};

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://spawnforge.ai';

// The pricing answer is generated, not written. Hand-written, it named plans by
// their internal billing keys ("Hobbyist", "Pro"), quoted a $99 top tier the
// pricing cards sold at $79, and promised free-tier AI chat that `/api/chat`
// rejects outright.
const FREE = getTierPlan('starter');
const ENTRY = getTierPlan('hobbyist');
const TOP = getTierPlan('pro');
const CAPS = currentPublicCapabilities();

// Claims about platform AI keys and hosted MCP follow the flags in
// `publicCapabilities.ts`: production holds no platform generation keys (#9117)
// and the hosted MCP bridge is off (#9722), so the copy says so until they ship.
const TOP_PLAN_AI_SENTENCE = CAPS.platformGenerationKeys
  ? `which reaches the platform AI keys without needing a token balance`
  : `which lifts the cloud project limit to ${PROJECT_LIMITS.pro === Infinity ? 'unlimited' : PROJECT_LIMITS.pro} and adds the Pro AI panels (platform-managed AI keys are coming after launch)`;
const GENERATION_SENTENCE = CAPS.platformGenerationKeys
  ? ''
  : ' Generating 3D models, textures and audio currently needs your own provider API key (Meshy or ElevenLabs).';
const MCP_AVAILABILITY_SENTENCE = CAPS.hostedMcp
  ? ''
  : ' External MCP clients can drive a local build today; attaching one to the hosted editor is coming after launch.';

const faqs = [
  {
    question: 'What is SpawnForge?',
    answer:
      'SpawnForge is an AI-powered, browser-based 2D and 3D game creation platform. It lets you build games using natural language prompts or a visual editor — no downloads or installs required. The engine is built in Rust, compiled to WebAssembly, and renders via WebGPU with a WebGL2 fallback.',
  },
  {
    question: 'Is SpawnForge free?',
    answer:
      `Yes. The ${FREE.name} tier includes the full editor, local export, ${countLabel(PROJECT_LIMITS.starter, 'cloud project', 'cloud projects')}, and ${countLabel(PUBLISH_LIMITS.starter, 'published game', 'published games')} — plus a one-time grant of ${TRIAL_GRANT_TOKENS} AI tokens at signup, so you can try AI chat before adding a card. Once the trial tokens are spent, ongoing AI access starts on the ${ENTRY.name} plan at ${ENTRY.price}/month, which adds a monthly AI token allowance and bring-your-own-key support. Plans go up to ${TOP.price}/month (${TOP.name}), ${TOP_PLAN_AI_SENTENCE}.`,
  },
  {
    question: 'What browsers does SpawnForge support?',
    answer:
      'SpawnForge works in any modern browser. It uses WebGPU for primary rendering (Chrome 113+, Edge 113+, Firefox Nightly) and automatically falls back to WebGL2 for broader compatibility (Chrome 56+, Firefox 51+, Safari 15+, Edge 79+).',
  },
  {
    question: 'Can I export games from SpawnForge?',
    answer:
      "Yes. You can publish games to a shareable URL with one click, or export them as standalone HTML/JS bundles that run anywhere. Published games are hosted on SpawnForge's CDN and playable at spawnforge.ai/play/[your-id]/[game-slug].",
  },
  {
    question: 'Does SpawnForge support 3D games?',
    answer:
      'Yes. SpawnForge supports both 2D and 3D game development. 3D features include PBR materials (56 presets), skeletal animation, GPU particles, CSG boolean operations, procedural terrain, GLTF model import, and real-time Rapier 3D physics simulation.',
  },
  {
    question: 'How does AI game creation work?',
    answer:
      `You describe what you want in natural language — for example, "create a platformer with a jumping character and moving platforms." Multi-agent AI interprets your prompt and executes commands to build the scene, add physics, configure scripting, and set up game logic. You can then refine everything manually in the visual editor.${GENERATION_SENTENCE}`,
  },
  {
    question: 'What is MCP for game development?',
    answer:
      `MCP (Model Context Protocol) is the command interface between the AI and the game engine. SpawnForge exposes ${MCP_COMMAND_COUNT} MCP commands across ${MCP_CATEGORY_COUNT} categories — from spawning entities and applying materials to configuring physics, audio, animation, scripting, and game components. This gives the AI precise, fine-grained control over every aspect of game creation.${MCP_AVAILABILITY_SENTENCE}`,
  },
  {
    question: 'How does SpawnForge compare to Unity or Godot?',
    answer:
      'SpawnForge is browser-native (no download/install), AI-first (natural language game creation), and uses WebGPU rendering. Unlike Unity (C#) or Godot (GDScript), SpawnForge uses TypeScript scripting and visual scripting with 73 node types. It publishes games to the web with one click. The tradeoff: SpawnForge targets web games specifically, while Unity/Godot support native desktop and mobile builds.',
  },
] as const;

// Static FAQPage JSON-LD (safe constant — no user input, no XSS risk)
const faqJsonLd = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'FAQPage',
  mainEntity: faqs.map((faq) => ({
    '@type': 'Question',
    name: faq.question,
    acceptedAnswer: {
      '@type': 'Answer',
      text: faq.answer,
    },
  })),
  url: `${SITE_URL}/faq`,
});

export default async function FaqPage() {
  'use cache';
  cacheLife('days');
  cacheTag('faq');

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      {/* JSON-LD structured data — static constant, no user input */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: faqJsonLd }}
      />
      <h1 className="mb-2 text-3xl font-bold tracking-tight text-white sm:text-4xl">
        Frequently Asked Questions
      </h1>
      <p className="mb-12 text-zinc-400">
        Common questions about SpawnForge, the AI-powered game creation platform.
      </p>
      <dl className="space-y-8">
        {faqs.map((faq) => (
          <div key={faq.question} className="border-b border-zinc-800 pb-8 last:border-0">
            <dt className="mb-3 text-lg font-semibold text-white">{faq.question}</dt>
            <dd className="text-zinc-300 leading-relaxed">{faq.answer}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
