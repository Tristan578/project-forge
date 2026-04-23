import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { GalleryPage } from '@/components/community/GalleryPage';

export const metadata: Metadata = {
  title: 'Community Gallery - SpawnForge',
  description: 'Discover and play games created by the SpawnForge community. Browse, play, and get inspired by AI-powered 2D and 3D browser games.',
  alternates: { canonical: '/community' },
  openGraph: {
    title: 'Community Gallery - SpawnForge',
    description: 'Discover and play games created by the SpawnForge community.',
  },
};

export default async function CommunityPage() {
  'use cache';
  cacheLife('days');
  cacheTag('community');
  return <GalleryPage />;
}
