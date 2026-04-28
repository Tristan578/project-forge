export interface BlogPost {
  slug: string;
  title: string;
  description: string;
  date: string;
  author: string;
  readingTime: string;
}

export const blogPosts: BlogPost[] = [
  {
    slug: 'spawnforge-browser-ai-game-engine',
    title: 'SpawnForge: The Browser-Based AI Game Engine',
    description:
      'An overview of SpawnForge — the AI-native 2D/3D game engine that runs entirely in your browser. Build games with natural language, visual scripting, or code.',
    date: '2026-04-14',
    author: 'SpawnForge Team',
    readingTime: '6 min read',
  },
  {
    slug: 'spawnforge-vs-unity-vs-godot',
    title: 'SpawnForge vs Unity vs Godot: Complete Comparison',
    description:
      'A detailed comparison of SpawnForge, Unity, and Godot for browser-based game development — setup, languages, AI features, pricing, and publishing.',
    date: '2026-04-14',
    author: 'SpawnForge Team',
    readingTime: '8 min read',
  },
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find((p) => p.slug === slug);
}

export function getAllBlogSlugs(): string[] {
  return blogPosts.map((p) => p.slug);
}
