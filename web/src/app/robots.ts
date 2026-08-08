import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/constants";

/**
 * A robots.txt `Disallow` value is a plain PREFIX match, not a path-segment
 * match — so `Disallow: /admin/` never matches the canonical URL `/admin`, only
 * things beneath it. Every entry here used to carry a trailing slash, which left
 * `/dev` (the auth-bypass route), `/settings`, `/health` and `/api-docs`
 * crawlable at exactly the URL each entry was written to block.
 *
 * Dropping the slash matches both the bare path and its whole subtree. It also
 * matches any future sibling sharing the prefix (`/settings-beta`, say) — the
 * inverse of the Clerk public-route matcher, where a prefix match widens what is
 * exposed. Here it widens what is withheld, which is the safe direction.
 *
 * `/api/` keeps its slash deliberately: there is no bare `/api` page to miss,
 * and the entry already covers every route beneath it.
 */
const DISALLOW_PRIVATE = ["/api/", "/admin", "/dev", "/settings", "/health", "/api-docs"];

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
