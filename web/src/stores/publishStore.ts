import { create } from 'zustand';

export interface PublishedGameInfo {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  status: 'published' | 'unpublished' | 'processing';
  version: number;
  playCount: number;
  url: string;
  createdAt: string;
  updatedAt: string;
}

interface PublishState {
  publications: PublishedGameInfo[];
  isPublishing: boolean;
  publishError: string | null;

  // Actions
  fetchPublications: () => Promise<void>;
  publishGame: (projectId: string, title: string, slug: string, description?: string) => Promise<PublishedGameInfo | null>;
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
      const data = await res.json();
      set({ publications: data.publications || [] });
    } catch {
      // silently fail
    }
  },

  publishGame: async (projectId, title, slug, description) => {
    set({ isPublishing: true, publishError: null });
    try {
      const res = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, title, slug, description }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Publish failed' }));
        set({ isPublishing: false, publishError: err.error });
        return null;
      }
      const data = await res.json();
      await get().fetchPublications();
      set({ isPublishing: false });
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
