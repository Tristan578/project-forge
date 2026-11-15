import { create } from 'zustand';
import { trackEvent, AnalyticsEvent } from '@/lib/analytics/posthog';

export interface PublicationListItem {
  id: string;
  projectId: string;
  slug: string;
  title: string;
  description: string | null;
  // 'flagged' = auto-hidden pending moderation review (#8354). /api/publish/list
  // returns publishedGames.status verbatim for every row the owner has, so this
  // union must admit it — the value crosses a JSON boundary, which means
  // TypeScript cannot catch the omission.
  status: 'published' | 'unpublished' | 'processing' | 'flagged';
  version: number;
  url: string;
  createdAt: string;
  updatedAt: string;
}

export interface PublishedGameInfo extends PublicationListItem {
  playCount: number;
}

interface PublishState {
  publications: PublicationListItem[];
  isPublishing: boolean;
  publishError: string | null;

  // Actions
  fetchPublications: () => Promise<void>;
  publishGame: (projectId: string, title: string, slug: string, description?: string, tags?: string[], thumbnail?: string | null) => Promise<PublishedGameInfo | null>;
  unpublishGame: (id: string) => Promise<boolean>;
  checkSlug: (slug: string) => Promise<boolean>;
}

export const usePublishStore = create<PublishState>((set, get) => ({
  publications: [],
  isPublishing: false,
  publishError: null,

  fetchPublications: async () => {
    try {
      const res = await fetch('/api/publish/list');
      if (!res.ok) return;
      const data = await res.json() as { publications?: PublicationListItem[] };
      set({ publications: data.publications ?? [] });
    } catch {
      // silently fail
    }
  },

  publishGame: async (projectId, title, slug, description, tags, thumbnail) => {
    set({ isPublishing: true, publishError: null });
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, title, slug, description, tags, thumbnail }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Publish failed' }));
        set({ isPublishing: false, publishError: err.error });
        return null;
      }
      const data = await res.json();
      await get().fetchPublications();
      set({ isPublishing: false });
      trackEvent(AnalyticsEvent.GAME_PUBLISHED, { slug, projectId });
      return data.publication;
    } catch (err) {
      set({ isPublishing: false, publishError: err instanceof Error ? err.message : 'Unknown error' });
      return null;
    }
  },

  unpublishGame: async (id) => {
    try {
      const res = await fetch(`/api/publish/${id}`, { method: 'DELETE' });
      if (!res.ok) return false;
      await get().fetchPublications();
      return true;
    } catch {
      return false;
    }
  },

  checkSlug: async (slug) => {
    try {
      const res = await fetch(`/api/publish/check-slug?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) return false;
      const data = await res.json();
      return data.available;
    } catch {
      return false;
    }
  },
}));
