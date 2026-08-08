import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import {
  getTierPlan,
  countLabel,
  PROJECT_LIMITS,
  PUBLISH_LIMITS,
} from '@/lib/billing/tierPlans';

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

const faqs = [
  {
    question: 'What is SpawnForge?',
    answer:
      'SpawnForge is an AI-powered, browser-based 2D and 3D game creation platform. It lets you build games using natural language prompts or a visual editor — no downloads or installs required. The engine is built in Rust, compiled to WebAssembly, and renders via WebGPU with a WebGL2 fallback.',
  },
  {
    question: 'Is SpawnForge free?',
    answer:
      `Yes. The ${FREE.name} tier includes the full editor, local export, ${countLabel(PROJECT_LIMITS.starter, 'cloud project', 'cloud projects')}, and ${countLabel(PUBLISH_LIMITS.starter, 'published game', 'published games')} — everything except the AI features. AI starts on the ${ENTRY.name} plan at ${ENTRY.price}/month, which adds AI chat, asset generation, and bring-your-own-key support. Plans go up to ${TOP.price}/month (${TOP.name}), which reaches the platform AI keys without needing a token balance.`,
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
      'You describe what you want in natural language — for example, "create a platformer with a jumping character and moving platforms." Multi-agent AI interprets your prompt and executes commands to build the scene, add physics, configure scripting, generate assets, and set up game logic. You can then refine everything manually in the visual editor.',
  },
  {
    question: 'What is MCP for game development?',
    answer:
      'MCP (Model Context Protocol) is the command interface between the AI and the game engine. SpawnForge exposes 351 MCP commands across 41 categories — from spawning entities and applying materials to configuring physics, audio, animation, scripting, and game components. This gives the AI precise, fine-grained control over every aspect of game creation.',
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
