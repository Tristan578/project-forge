import { ImageResponse } from 'next/og';

export const alt = 'SpawnForge — AI-Powered Game Creation Platform';
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
        {/* Logo mark */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 96,
            height: 96,
            borderRadius: 20,
            background: 'linear-gradient(135deg, #f97316, #ea580c)',
            marginBottom: 32,
            fontSize: 52,
          }}
        >
          ⚒
        </div>

        {/* Title */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 800,
            color: '#ffffff',
            letterSpacing: -2,
            marginBottom: 16,
          }}
        >
          SpawnForge
        </div>

        {/* Tagline */}
        <div
          style={{
            fontSize: 28,
            color: 'rgba(255, 255, 255, 0.7)',
            textAlign: 'center',
            maxWidth: 800,
          }}
        >
          AI-Powered Game Creation Platform — build 2D and 3D games in your browser
        </div>

        {/* Bottom accent line */}
        <div
          style={{
            display: 'flex',
            marginTop: 48,
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
