/**
 * IceFrost — SVG stroke-dashoffset animation + CSS shimmer for the ice theme.
 * Frost crack lines "grow" across panel borders. Pure CSS/SVG, no JS animation.
 */

export default function IceFrost() {
  return (
    <>
      {/* Shimmer overlay */}
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background: 'linear-gradient(135deg, rgba(186,230,253,0.06) 0%, rgba(147,197,253,0.08) 50%, rgba(186,230,253,0.04) 100%)',
          animation: 'sf-shimmer 6s ease-in-out infinite',
        }}
      />

      {/* SVG frost crack lines */}
      <svg
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}
        viewBox="0 0 1000 600"
        preserveAspectRatio="xMidYMid slice"
        aria-hidden="true"
      >
        {/* Top-left crack */}
        <path
          d="M0,80 L60,120 L40,200 L90,240"
          fill="none"
          stroke="rgba(186,230,253,0.5)"
          strokeWidth="1"
          strokeDasharray="400"
          style={{
            strokeDashoffset: 400,
            animation: 'sf-frost-grow 8s ease-out infinite',
          }}
        />
        {/* Bottom-right crack */}
        <path
          d="M1000,520 L940,480 L960,400 L910,360"
          fill="none"
          stroke="rgba(147,197,253,0.4)"
          strokeWidth="1"
          strokeDasharray="400"
          style={{
            strokeDashoffset: 400,
            animation: 'sf-frost-grow 8s ease-out infinite',
            animationDelay: '3s',
          }}
        />
        {/* Left edge crack */}
        <path
          d="M0,300 L30,280 L20,320 L50,340 L35,380"
          fill="none"
          stroke="rgba(186,230,253,0.35)"
          strokeWidth="0.8"
          strokeDasharray="400"
          style={{
            strokeDashoffset: 400,
            animation: 'sf-frost-grow 10s ease-out infinite',
            animationDelay: '5s',
          }}
        />
        {/* Top-right crack */}
        <path
          d="M1000,100 L960,130 L980,180 L950,210"
          fill="none"
          stroke="rgba(147,197,253,0.45)"
          strokeWidth="1"
          strokeDasharray="400"
          style={{
            strokeDashoffset: 400,
            animation: 'sf-frost-grow 9s ease-out infinite',
            animationDelay: '1.5s',
          }}
        />
      </svg>
    </>
  );
}
