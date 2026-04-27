import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import Link from 'next/link';
import { blogPosts } from '@/lib/blog';

export const metadata: Metadata = {
  title: 'Blog — SpawnForge',
  description:
    'News, tutorials, and insights about AI-powered game creation with SpawnForge.',
  alternates: { canonical: '/blog' },
  openGraph: {
    title: 'SpawnForge Blog',
    description:
      'News, tutorials, and comparisons for AI game development.',
  },
};

export default async function BlogIndexPage() {
  'use cache';
  cacheLife('days');
  cacheTag('blog');

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="mb-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
        Blog
      </h1>
      <p className="mb-12 text-lg text-zinc-300">
        News, tutorials, and insights about AI-powered game creation.
      </p>

      <div className="space-y-8">
        {blogPosts.map((post) => (
          <article key={post.slug} className="group">
            <Link href={`/blog/${post.slug}`} className="block rounded-lg border border-zinc-800 bg-zinc-900/50 p-6 transition-colors hover:border-orange-500/50 hover:bg-zinc-900">
              <div className="mb-2 flex items-center gap-3 text-sm text-zinc-500">
                <time dateTime={post.date}>
                  {new Date(post.date).toLocaleDateString('en-US', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                  })}
                </time>
                <span>&middot;</span>
                <span>{post.readingTime}</span>
              </div>
              <h2 className="mb-2 text-xl font-semibold text-white group-hover:text-orange-400">
                {post.title}
              </h2>
              <p className="text-zinc-400">{post.description}</p>
            </Link>
          </article>
        ))}
      </div>
    </div>
  );
}
