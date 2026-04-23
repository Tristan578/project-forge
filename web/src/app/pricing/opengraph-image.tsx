import { ImageResponse } from 'next/og';

export const alt = 'SpawnForge Pricing — Free, Starter, Pro, and Studio Plans';
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
          Pricing
        </div>

        <div
          style={{
            fontSize: 24,
            color: 'rgba(255, 255, 255, 0.7)',
            textAlign: 'center',
            maxWidth: 800,
            marginBottom: 40,
          }}
        >
          From free to studio — choose the plan that fits your game creation needs
        </div>

        <div style={{ display: 'flex', gap: 24 }}>
          {(['Free', '$9/mo', '$29/mo', '$99/mo'] as const).map((price, i) => (
            <div
              key={i}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                padding: '20px 28px',
                borderRadius: 12,
                background: i === 2 ? 'rgba(249, 115, 22, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                border: i === 2 ? '2px solid rgba(249, 115, 22, 0.5)' : '1px solid rgba(255, 255, 255, 0.1)',
              }}
            >
              <div style={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.5)', marginBottom: 4 }}>
                {(['Free', 'Starter', 'Pro', 'Studio'] as const)[i]}
              </div>
              <div style={{ fontSize: 22, fontWeight: 700, color: '#ffffff' }}>{price}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    { ...size }
  );
}
