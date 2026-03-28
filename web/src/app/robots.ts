import type { MetadataRoute } from "next";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://spawnforge.ai";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/api/", "/admin/", "/dev/", "/settings/", "/health/", "/api-docs/"],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
