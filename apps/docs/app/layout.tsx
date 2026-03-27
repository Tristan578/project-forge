import './globals.css';
import type { ReactNode } from 'react';

export const metadata = {
  title: 'SpawnForge Documentation',
  description: 'API reference and MCP command documentation for SpawnForge',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
