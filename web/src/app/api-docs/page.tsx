'use client';

import { useEffect, useRef } from 'react';

declare global {
  interface Window {
    SwaggerUIBundle: (config: {
      url: string;
      dom_id: string;
      presets: unknown[];
      layout: string;
      deepLinking?: boolean;
      tryItOutEnabled?: boolean;
      supportedSubmitMethods?: string[];
      validatorUrl?: string | null;
    }) => void;
  }
}

/**
 * /api-docs — Swagger UI rendered from /api/openapi.
 *
 * Loads Swagger UI from the jsDelivr CDN (no npm dependency required).
 * CDN: https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/
 */
export default function ApiDocsPage() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Inject Swagger UI stylesheet
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css';
    document.head.appendChild(link);

    // Inject Swagger UI bundle script
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js';
    script.onload = () => {
      if (!containerRef.current) return;
      if (typeof window.SwaggerUIBundle !== 'function') return;

      window.SwaggerUIBundle({
        url: '/api/openapi',
        dom_id: '#swagger-ui',
        presets: [
          (window.SwaggerUIBundle as unknown as { presets: { apis: unknown } })
            .presets.apis,
        ],
        layout: 'BaseLayout',
        deepLinking: true,
        tryItOutEnabled: false,
        supportedSubmitMethods: [],
        validatorUrl: null,
      });
    };
    document.body.appendChild(script);

    return () => {
      link.remove();
      script.remove();
    };
  }, []);

  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#fafafa' }}>
      <div
        style={{
          background: '#1a1a2e',
          color: '#e0e0e0',
          padding: '16px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: '12px',
          borderBottom: '2px solid #7c3aed',
        }}
      >
        <span style={{ fontSize: '22px', fontWeight: 700, letterSpacing: '-0.5px' }}>
          SpawnForge
        </span>
        <span style={{ color: '#a78bfa', fontSize: '14px' }}>REST API Reference</span>
        <a
          href="/api/openapi"
          download="openapi.json"
          style={{
            marginLeft: 'auto',
            fontSize: '12px',
            color: '#a78bfa',
            textDecoration: 'none',
            border: '1px solid #7c3aed',
            padding: '4px 10px',
            borderRadius: '4px',
          }}
        >
          Download OpenAPI JSON
        </a>
      </div>
      <div id="swagger-ui" ref={containerRef} />
    </div>
  );
}
