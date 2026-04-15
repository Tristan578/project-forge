import { ImageResponse } from 'next/og';

export const alt = 'SpawnForge Community Gallery — Discover and Play Games';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

export default function Image() {
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
          background: 'linear-gradient(135deg, #0a0a0a 0%, #1a1a2e 40%, #16213e 70%, #0f3460 100%)',
          padding: 60,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 80,
            height: 80,
            borderRadius: 16,
            background: 'linear-gradient(135deg, #f97316, #ea580c)',
            marginBottom: 24,
            fontSize: 44,
          }}
        >
          ⚒
        </div>

        <div
          style={{
            fontSize: 56,
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: -2,
            marginBottom: 12,
          }}
        >
          Community Gallery
        </div>

        <div
          style={{
            fontSize: 24,
            color: 'rgba(255, 255, 255, 0.7)',
            textAlign: 'center',
            maxWidth: 800,
          }}
        >
          Discover and play games created by the SpawnForge community
        </div>

        <div
          style={{
            display: 'flex',
            marginTop: 40,
            width: 120,
            height: 4,
            borderRadius: 2,
            background: 'linear-gradient(90deg, #f97316, #ea580c)',
          }}
        />
      </div>
    ),
    { ...size }
  );
}
