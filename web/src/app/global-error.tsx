"use client";

import { useEffect } from "react";
import { captureException } from "@/lib/monitoring/sentry-client";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  const displayMessage =
    process.env.NODE_ENV === 'development'
      ? error.message
      : 'A critical error occurred and the page could not be rendered.';

  useEffect(() => {
    captureException(error);
  }, [error]);

  return (
    <html lang="en" className="dark">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: "#09090b",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ textAlign: "center", padding: "0 1rem" }}>
          <p
            style={{
              color: "#71717a",
              fontSize: "0.75rem",
              letterSpacing: "0.1em",
              textTransform: "uppercase",
              fontFamily: "monospace",
              marginBottom: "0.5rem",
            }}
          >
            Critical Error
          </p>
          <h1
            style={{
              color: "#f4f4f5",
              fontSize: "1.875rem",
              fontWeight: 700,
              margin: "0 0 0.5rem",
            }}
          >
            Application failed to load
          </h1>
          <p
            style={{
              color: "#a1a1aa",
              maxWidth: "24rem",
              margin: "0 auto 1.5rem",
            }}
          >
            {displayMessage}
          </p>
          <button
            onClick={reset}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "0.5rem 1rem",
              borderRadius: "0.375rem",
              backgroundColor: "#27272a",
              color: "#f4f4f5",
              border: "none",
              cursor: "pointer",
              fontSize: "0.875rem",
              fontWeight: 500,
            }}
          >
            Try Again
          </button>
        </div>
      </body>
    </html>
  );
}
