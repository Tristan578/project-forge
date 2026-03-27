/**
 * MechScanlines — CSS linear-gradient scan line + HUD corner brackets for mech theme.
 * Full-width scan line moves vertically. Corner brackets on panels via CSS borders.
 * Pure CSS, no JS animation.
 */

export default function MechScanlines() {
  return (
    <>
      <style>{`
        @keyframes sf-scanline {
          0%   { transform: translateY(-100%); opacity: 0; }
          5%   { opacity: 0.5; }
          95%  { opacity: 0.3; }
          100% { transform: translateY(100vh); opacity: 0; }
        }
        @keyframes sf-hud-blink {
          0%, 100% { opacity: 0.6; }
          50%      { opacity: 0.3; }
        }
        @keyframes sf-scanline-pulse {
          0%, 100% { opacity: 0.08; }
          50%      { opacity: 0.12; }
        }
      `}</style>

      {/* Moving scan line */}
      <div
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          height: '2px',
          background: 'linear-gradient(to right, transparent, rgba(59,130,246,0.4) 20%, rgba(99,102,241,0.5) 50%, rgba(59,130,246,0.4) 80%, transparent)',
          animation: 'sf-scanline 8s linear infinite',
          top: 0,
        }}
      />

      {/* Static scanline texture overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: 'repeating-linear-gradient(0deg, transparent, transparent 3px, rgba(59,130,246,0.02) 3px, rgba(59,130,246,0.02) 4px)',
          animation: 'sf-scanline-pulse 4s ease-in-out infinite',
        }}
      />

      {/* Top-left HUD bracket */}
      <div
        style={{
          position: 'absolute',
          top: '8px',
          left: '8px',
          width: '20px',
          height: '20px',
          borderTop: '2px solid rgba(99,102,241,0.5)',
          borderLeft: '2px solid rgba(99,102,241,0.5)',
          animation: 'sf-hud-blink 3s ease-in-out infinite',
        }}
      />

      {/* Top-right HUD bracket */}
      <div
        style={{
          position: 'absolute',
          top: '8px',
          right: '8px',
          width: '20px',
          height: '20px',
          borderTop: '2px solid rgba(99,102,241,0.5)',
          borderRight: '2px solid rgba(99,102,241,0.5)',
          animation: 'sf-hud-blink 3s ease-in-out infinite',
          animationDelay: '0.5s',
        }}
      />

      {/* Bottom-left HUD bracket */}
      <div
        style={{
          position: 'absolute',
          bottom: '8px',
          left: '8px',
          width: '20px',
          height: '20px',
          borderBottom: '2px solid rgba(99,102,241,0.5)',
          borderLeft: '2px solid rgba(99,102,241,0.5)',
          animation: 'sf-hud-blink 3s ease-in-out infinite',
          animationDelay: '1s',
        }}
      />

      {/* Bottom-right HUD bracket */}
      <div
        style={{
          position: 'absolute',
          bottom: '8px',
          right: '8px',
          width: '20px',
          height: '20px',
          borderBottom: '2px solid rgba(99,102,241,0.5)',
          borderRight: '2px solid rgba(99,102,241,0.5)',
          animation: 'sf-hud-blink 3s ease-in-out infinite',
          animationDelay: '1.5s',
        }}
      />
    </>
  );
}
