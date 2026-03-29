'use cache';

import { cacheLife } from 'next/cache';
import { cacheTag } from 'next/cache';
import { GalleryPage } from '@/components/community/GalleryPage';

export const metadata = {
  title: 'Community Gallery - SpawnForge',
  description: 'Discover and play games created by the community',
};

export default function CommunityPage() {
  cacheLife('days');
  cacheTag('community');
  return <GalleryPage />;
}
