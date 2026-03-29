import { cacheLife, cacheTag } from 'next/cache';
import { GalleryPage } from '@/components/community/GalleryPage';

export const metadata = {
  title: 'Community Gallery - SpawnForge',
  description: 'Discover and play games created by the community',
};

export default async function CommunityPage() {
  'use cache';
  cacheLife('days');
  cacheTag('community');
  return <GalleryPage />;
}
