import './globals.css';
import type { ReactNode } from 'react';
import { ClerkProvider } from '@clerk/nextjs';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'SpawnForge Documentation',
  description: 'API reference and MCP command documentation for SpawnForge',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <ClerkProvider>
      <html lang="en" className="dark">
        <body>{children}</body>
      </html>
    </ClerkProvider>
  );
}
