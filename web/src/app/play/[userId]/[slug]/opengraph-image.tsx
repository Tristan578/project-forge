import { ImageResponse } from 'next/og';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { publishedGames, users } from '@/lib/db/schema';
import { eq, and } from 'drizzle-orm';

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

export default async function Image({ params }: Props) {
  const { userId: clerkId, slug } = await params;

  try {
    const [user] = await queryWithResilience(() =>
      getDb()
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(eq(users.clerkId, clerkId))
        .limit(1)
    );

    if (!user) return renderFallback();

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

    if (!game) return renderFallback();

    const creatorName = user.displayName || 'Unknown Creator';
    const description = game.description || 'Play this game on SpawnForge';
    const truncatedDesc = description.length > 120
      ? description.slice(0, 117) + '...'
      : description;

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
              {game.title}
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
                {creatorName[0]?.toUpperCase() ?? '?'}
              </div>
              <div style={{ fontSize: 22, color: 'rgba(255,255,255,0.8)' }}>
                {creatorName}
              </div>
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
                  fontSize: 16,
                }}
              >
                ⚒
              </div>
              <div style={{ fontSize: 20, color: 'rgba(255,255,255,0.6)' }}>
                SpawnForge
              </div>
            </div>
          </div>
        </div>
      ),
      { ...size }
    );
  } catch {
    return renderFallback();
  }
}
