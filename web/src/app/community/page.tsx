import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import { GalleryPage } from '@/components/community/GalleryPage';
import { Breadcrumbs } from '@/components/marketing/Breadcrumbs';

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
  return (
    <div className="mx-auto max-w-7xl px-4 pt-8 sm:px-6 lg:px-8">
      <Breadcrumbs items={[{ label: 'Community', href: '/community' }]} />
      <GalleryPage />
    </div>
  );
}
