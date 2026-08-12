import { ImageResponse } from 'next/og';
import { TIER_PLANS } from '@/lib/billing/tierPlans';
import { BrandMark } from '@/lib/og/BrandMark';

// This route runs on the Edge runtime, so `tierPlans` must stay a pure
// constants module — it is, deliberately.
export const alt = `SpawnForge Pricing — ${TIER_PLANS.map((p) => p.name).join(', ')} Plans`;
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
          }}
        >
          <BrandMark size={44} />
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
          {TIER_PLANS.map((plan) => {
            // The share card is the first price a lot of people see. It used to
            // hardcode its own names and prices, and advertised a $99 "Pro" plan
            // that the pricing page sold as "Creator" for $29.
            const highlighted = plan.key === 'creator';
            return (
              <div
                key={plan.key}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  padding: '20px 28px',
                  borderRadius: 12,
                  background: highlighted ? 'rgba(249, 115, 22, 0.15)' : 'rgba(255, 255, 255, 0.05)',
                  border: highlighted
                    ? '2px solid rgba(249, 115, 22, 0.5)'
                    : '1px solid rgba(255, 255, 255, 0.1)',
                }}
              >
                <div style={{ fontSize: 14, color: 'rgba(255, 255, 255, 0.5)', marginBottom: 4 }}>
                  {plan.name}
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#ffffff' }}>
                  {`${plan.price}/mo`}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    ),
    { ...size }
  );
}
