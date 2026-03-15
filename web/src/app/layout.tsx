import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import type { BeforeSendEvent } from "@vercel/analytics";
import { Toaster } from "sonner";
import "./globals.css";

// Prevent static prerendering — all pages require auth (ClerkProvider)
export const dynamic = "force-dynamic";

// Analytics environment: "development" logs to console only, "production" sends data
const analyticsMode =
  process.env.NODE_ENV === "development" ? "development" : "production";

// Filter out internal routes from analytics
function analyticsBeforeSend(event: BeforeSendEvent): BeforeSendEvent | null {
  const url = event.url;
  // Exclude dev bypass, admin, and API routes
  if (url.includes("/dev") || url.includes("/admin") || url.includes("/api/")) {
    return null;
  }
  return event;
}

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
        <Analytics mode={analyticsMode} beforeSend={analyticsBeforeSend} />
        <SpeedInsights />
        <Toaster theme="dark" position="bottom-right" richColors />
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
