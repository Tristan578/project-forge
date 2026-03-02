import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { SpeedInsights } from "@vercel/speed-insights/next";
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

export const metadata: Metadata = {
  title: "SpawnForge",
  description: "AI-Powered Game Creation Platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const body = (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
        suppressHydrationWarning
      >
        {children}
        <SpeedInsights />
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
