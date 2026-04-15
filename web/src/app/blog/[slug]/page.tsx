import type { Metadata } from 'next';
import { cacheLife, cacheTag } from 'next/cache';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getBlogPost, getAllBlogSlugs } from '@/lib/blog';
import SpawnForgeBrowserAiGameEngine from '../content/spawnforge-browser-ai-game-engine';
import SpawnForgeVsUnityVsGodot from '../content/spawnforge-vs-unity-vs-godot';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? 'https://spawnforge.ai';

const contentComponents: Record<string, React.ComponentType> = {
  'spawnforge-browser-ai-game-engine': SpawnForgeBrowserAiGameEngine,
  'spawnforge-vs-unity-vs-godot': SpawnForgeVsUnityVsGodot,
};

export function generateStaticParams() {
  return getAllBlogSlugs().map((slug) => ({ slug }));
}

interface BlogPostPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: BlogPostPageProps): Promise<Metadata> {
  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) return { title: 'Not Found — SpawnForge' };

  return {
    title: post.title,
    description: post.description,
    alternates: { canonical: `/blog/${slug}` },
    openGraph: {
      title: post.title,
      description: post.description,
      type: 'article',
      publishedTime: post.date,
      authors: [post.author],
    },
  };
}

export default async function BlogPostPage({ params }: BlogPostPageProps) {
  'use cache';
  cacheLife('days');
  cacheTag('blog');

  const { slug } = await params;
  const post = getBlogPost(slug);
  if (!post) notFound();

  const Content = contentComponents[slug];
  if (!Content) notFound();

  // Static JSON-LD from static blog metadata — no user input, safe for injection
  const jsonLd = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BlogPosting',
    headline: post.title,
    description: post.description,
    datePublished: post.date,
    author: {
      '@type': 'Organization',
      name: post.author,
      url: SITE_URL,
    },
    publisher: {
      '@type': 'Organization',
      name: 'SpawnForge',
      url: SITE_URL,
    },
    url: `${SITE_URL}/blog/${slug}`,
    mainEntityOfPage: `${SITE_URL}/blog/${slug}`,
  });

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd }}
      />
      <article className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <Link
          href="/blog"
          className="mb-8 inline-flex items-center text-sm text-zinc-400 hover:text-orange-400"
        >
          &larr; All posts
        </Link>

        <header className="mb-10">
          <h1 className="mb-4 text-3xl font-bold tracking-tight text-white sm:text-4xl">
            {post.title}
          </h1>
          <div className="flex items-center gap-3 text-sm text-zinc-500">
            <time dateTime={post.date}>
              {new Date(post.date).toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
            </time>
            <span>&middot;</span>
            <span>{post.readingTime}</span>
            <span>&middot;</span>
            <span>{post.author}</span>
          </div>
        </header>

        <div className="prose prose-invert prose-zinc max-w-none prose-headings:font-semibold prose-headings:tracking-tight prose-a:text-orange-400 prose-a:no-underline hover:prose-a:underline prose-code:rounded prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:text-orange-300">
          <Content />
        </div>
      </article>
    </>
  );
}
