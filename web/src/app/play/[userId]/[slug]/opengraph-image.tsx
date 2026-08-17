import { ImageResponse } from 'next/og';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';
import { BrandMark } from '@/lib/og/BrandMark';
import { initialFor, stripEmoji, truncateChars } from '@/lib/og/text';

export const alt = 'SpawnForge Game';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

interface Props {
  params: Promise<{ userId: string; slug: string }>;
}

/** Gradient palettes keyed by first character of slug for visual variety. */
const GRADIENTS: Record<string, string[]> = {
  a: ['#1a1a2e', '#16213e', '#0f3460'],
  b: ['#1a1a2e', '#2d1b4e', '#4a1942'],
  c: ['#0a1628', '#162d50', '#1e4d6e'],
  d: ['#1a0a0a', '#3d1414', '#5c1e1e'],
  e: ['#0a1a12', '#143d28', '#1e5c3c'],
};

function getGradient(slug: string): string {
  const key = (slug[0] ?? 'a').toLowerCase();
  const colors = GRADIENTS[key] ?? GRADIENTS.a;
  return `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 50%, ${colors[2]} 100%)`;
}

function renderFallback() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 50%, #0f3460 100%)',
          padding: 60,
        }}
      >
        <div style={{ fontSize: 64, fontWeight: 800, color: '#ffffff' }}>
          SpawnForge
        </div>
        <div style={{ fontSize: 24, color: 'rgba(255,255,255,0.6)', marginTop: 16 }}>
          Game not found
        </div>
      </div>
    ),
    { ...size }
  );
}

interface CardData {
  title: string;
  creatorName: string;
  description: string;
}

/**
 * Loads the card's text, or `null` when there is nothing to show.
 *
 * The try/catch stays around the query and nothing else: constructing JSX
 * inside one is misleading (React renders lazily, so a render error is never
 * caught there) and `react-hooks/error-boundaries` rejects it outright once the
 * tree contains a component rather than only host elements.
 */
async function loadCard(clerkId: string, slug: string): Promise<CardData | null> {
  try {
    const [user] = await queryWithResilience(() =>
      getDb()
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(eq(users.clerkId, clerkId))
        .limit(1)
    );

    if (!user) return null;

    const [game] = await queryWithResilience(() =>
      getDb()
        .select({
          title: publishedGames.title,
          description: publishedGames.description,
        })
        .from(publishedGames)
        .where(
          and(
            eq(publishedGames.userId, user.id),
            eq(publishedGames.slug, slug),
            eq(publishedGames.status, 'published')
          )
        )
        .limit(1)
    );

    if (!game) return null;

    // Every string here reaches satori, and satori resolves emoji through a
    // third-party CDN. These three are the only user-supplied text on the card.
    //
    // Stripping emoji closes that fetch, but it is not the only one: any
    // codepoint outside `@vercel/og`'s Latin-only bundled font is resolved
    // through `https://fonts.googleapis.com/css2?family=<font>&text=<the text
    // itself>`, so a CJK, Cyrillic, Arabic or Thai title is sent to Google in a
    // query string on every render. That is pre-existing and unchanged here,
    // and unlike the emoji path it fails open — the card still renders, with
    // the uncovered glyphs blank — which is why nothing has ever reported it.
    // Closing it means bundling a wider font set; tracked as PF-1153.
    const description = stripEmoji(game.description ?? '') || 'Play this game on SpawnForge';
    return {
      title: stripEmoji(game.title) || 'Untitled Game',
      creatorName: stripEmoji(user.displayName ?? '') || 'Unknown Creator',
      // Truncate after stripping — the emoji are gone by now, so the cut can no
      // longer land inside one. `truncateChars` counts codepoints, so it cannot
      // bisect a surrogate pair either (an astral non-emoji is untouched by the
      // strip and would still be cut in half by `slice`).
      description: truncateChars(description, 120),
    };
  } catch {
    return null;
  }
}

export default async function Image({ params }: Props) {
  const { userId: clerkId, slug } = await params;

  const card = await loadCard(clerkId, slug);
  if (!card) return renderFallback();

  const { title, creatorName, description: truncatedDesc } = card;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: getGradient(slug),
          padding: 60,
        }}
      >
        {/* Top: game info */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              fontSize: 56,
              fontWeight: 800,
              color: '#ffffff',
              letterSpacing: -1,
              lineHeight: 1.1,
              maxWidth: 900,
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 24,
              color: 'rgba(255, 255, 255, 0.65)',
              marginTop: 20,
              maxWidth: 800,
              lineHeight: 1.4,
            }}
          >
            {truncatedDesc}
          </div>
        </div>

        {/* Bottom: creator + SpawnForge branding */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 20,
                background: 'rgba(255,255,255,0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: 20,
                color: '#ffffff',
              }}
            >
              {initialFor(creatorName)}
            </div>
            <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.8)' }}>{creatorName}</div>
          </div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: 'linear-gradient(135deg, #f97316, #ea580c)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <BrandMark size={16} />
            </div>
            <div style={{ fontSize: 20, color: 'rgba(255,255,255,0.6)' }}>SpawnForge</div>
          </div>
        </div>
      </div>
    ),
    { ...size }
  );
}
