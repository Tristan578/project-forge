import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { defaultLocale } from "@/i18n/config";
import { Toaster } from "sonner";
import { AnalyticsProvider } from "@/components/AnalyticsProvider";
import { CookieConsent } from "@/components/CookieConsent";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { PostHogProvider } from "@/components/providers/PostHogProvider";
import "./globals.css";

// Prevent static prerendering — all pages require auth (ClerkProvider)
export const dynamic = "force-dynamic";

// Clerk validates key format at runtime — skip wrapping when key is missing/invalid (CI E2E tests)
const clerkKey = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "";
const hasValidClerkKey = clerkKey.startsWith("pk_test_") || clerkKey.startsWith("pk_live_");

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "https://spawnforge.ai";

export const metadata: Metadata = {
  title: "SpawnForge",
  description: "AI-Powered Game Creation Platform — build 2D and 3D games in your browser with natural language and a visual editor.",
  manifest: "/manifest.json",
  openGraph: {
    title: "SpawnForge",
    description: "AI-Powered Game Creation Platform — build 2D and 3D games in your browser with natural language and a visual editor.",
    url: SITE_URL,
    siteName: "SpawnForge",
    type: "website",
    images: [
      {
        url: `${SITE_URL}/og-image.png`,
        width: 1200,
        height: 630,
        alt: "SpawnForge — AI-Powered Game Creation Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "SpawnForge",
    description: "AI-Powered Game Creation Platform — build 2D and 3D games in your browser.",
    images: [`${SITE_URL}/og-image.png`],
  },
};

// Static JSON-LD Organization schema (safe constant — no user input)
const jsonLdString = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "SpawnForge",
  url: SITE_URL,
  logo: `${SITE_URL}/favicon.ico`,
  description: "AI-Powered Game Creation Platform — build 2D and 3D games in your browser with natural language and a visual editor.",
  sameAs: [],
});

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  setRequestLocale(defaultLocale);
  const messages = await getMessages();

  const body = (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        {/* JSON-LD structured data injected here; search engines read it from
            body per Schema.org and Google guidelines. Manual <head> tags are
            not permitted in Next.js App Router layouts (metadata export manages
            all head injection). jsonLdString is JSON.stringify of a static
            constant — no user input, no XSS risk. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLdString }}
        />
        <NextIntlClientProvider locale={defaultLocale} messages={messages}>
          {children}
        </NextIntlClientProvider>
        <AnalyticsProvider />
        <SpeedInsights />
        <Toaster theme="dark" position="bottom-right" richColors />
        <ServiceWorkerRegistration />
        <PostHogProvider />
        <CookieConsent />
      </body>
    </html>
  );

  if (!hasValidClerkKey) {
    return body;
  }

  return (
    <ClerkProvider appearance={{ baseTheme: dark }}>
      {body}
    </ClerkProvider>
  );
}
