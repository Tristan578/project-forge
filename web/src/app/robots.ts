import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://spawnforge.ai";

const DISALLOW_PRIVATE = ["/api/", "/admin/", "/dev/", "/settings/", "/health/", "/api-docs/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW_PRIVATE,
      },
      // AI crawlers — explicitly allow public content for LLM discoverability
      ...["GPTBot", "ChatGPT-User", "Google-Extended", "ClaudeBot", "CCBot", "PerplexityBot", "Anthropic"].map(
        (bot) => ({
          userAgent: bot,
          allow: ["/", "/pricing", "/community", "/play/", "/terms", "/privacy", "/llms.txt", "/llms-full.txt"],
          disallow: DISALLOW_PRIVATE,
        }),
      ),
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
