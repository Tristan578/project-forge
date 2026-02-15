/**
 * Loading Screen Customization
 * Generates custom loading HTML with various animation styles
 */

export interface LoadingScreenConfig {
  backgroundColor: string;
  logoDataUrl?: string;
  progressBarColor: string;
  progressStyle: 'bar' | 'spinner' | 'dots' | 'none';
  title?: string;
  subtitle?: string;
}

export function generateLoadingHtml(config: LoadingScreenConfig): string {
  const {
    backgroundColor,
    logoDataUrl,
    progressBarColor,
    progressStyle,
    title,
    subtitle,
  } = config;

  const logoHtml = logoDataUrl
    ? `<img src="${logoDataUrl}" alt="Game Logo" style="max-width: 200px; max-height: 100px; margin-bottom: 20px;" />`
    : '';

  const titleHtml = title ? `<h1 style="font-size: 28px; font-weight: bold; margin: 0 0 8px 0; color: white;">${escapeHtml(title)}</h1>` : '';
  const subtitleHtml = subtitle ? `<p style="font-size: 14px; margin: 0 0 24px 0; color: rgba(255,255,255,0.7);">${escapeHtml(subtitle)}</p>` : '';

  const progressHtml = getProgressHtml(progressStyle);

  return `
    <div id="loading-screen" style="
      position: fixed;
      inset: 0;
      background: ${backgroundColor};
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      z-index: 9999;
      transition: opacity 0.5s ease;
    ">
      ${logoHtml}
      ${titleHtml}
      ${subtitleHtml}
      ${progressHtml}
    </div>
    <style>
      ${getProgressStyles(progressStyle, progressBarColor)}
    </style>
  `.trim();
}

function getProgressHtml(style: LoadingScreenConfig['progressStyle']): string {
  switch (style) {
    case 'bar':
      return `
        <div class="progress-bar-container">
          <div class="progress-bar-fill"></div>
        </div>
        <p class="progress-text">Loading... <span id="progress-percent">0%</span></p>
      `;

    case 'spinner':
      return `
        <div class="spinner"></div>
        <p class="progress-text">Loading...</p>
      `;

    case 'dots':
      return `
        <div class="dots">
          <div class="dot"></div>
          <div class="dot"></div>
          <div class="dot"></div>
        </div>
        <p class="progress-text">Loading...</p>
      `;

    case 'none':
      return '';

    default:
      return `<p class="progress-text">Loading...</p>`;
  }
}

function getProgressStyles(style: LoadingScreenConfig['progressStyle'], color: string): string {
  const baseStyles = `
    .progress-text {
      font-size: 14px;
      color: rgba(255,255,255,0.8);
      margin-top: 16px;
    }
  `;

  switch (style) {
    case 'bar':
      return baseStyles + `
        .progress-bar-container {
          width: 300px;
          height: 6px;
          background: rgba(255,255,255,0.1);
          border-radius: 3px;
          overflow: hidden;
        }
        .progress-bar-fill {
          height: 100%;
          background: ${color};
          width: 0%;
          transition: width 0.3s ease;
          animation: progressShimmer 1.5s infinite;
        }
        @keyframes progressShimmer {
          0% { opacity: 1; }
          50% { opacity: 0.7; }
          100% { opacity: 1; }
        }
      `;

    case 'spinner':
      return baseStyles + `
        .spinner {
          width: 48px;
          height: 48px;
          border: 4px solid rgba(255,255,255,0.1);
          border-top-color: ${color};
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `;

    case 'dots':
      return baseStyles + `
        .dots {
          display: flex;
          gap: 12px;
        }
        .dot {
          width: 12px;
          height: 12px;
          background: ${color};
          border-radius: 50%;
          animation: bounce 1.4s infinite ease-in-out both;
        }
        .dot:nth-child(1) { animation-delay: -0.32s; }
        .dot:nth-child(2) { animation-delay: -0.16s; }
        @keyframes bounce {
          0%, 80%, 100% { transform: scale(0); }
          40% { transform: scale(1); }
        }
      `;

    default:
      return baseStyles;
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Generate script to update loading progress
 */
export function generateLoadingScript(style: LoadingScreenConfig['progressStyle']): string {
  if (style === 'bar') {
    return `
      // Update loading progress
      function updateProgress(percent) {
        const fill = document.querySelector('.progress-bar-fill');
        const text = document.getElementById('progress-percent');
        if (fill) fill.style.width = percent + '%';
        if (text) text.textContent = Math.round(percent) + '%';
      }

      // Simulate progress during WASM load
      let progress = 0;
      const progressInterval = setInterval(() => {
        progress += Math.random() * 15;
        if (progress > 90) progress = 90; // Cap at 90% until real load
        updateProgress(progress);
      }, 200);

      // Clear interval when ready
      window.addEventListener('forge:engine-ready', () => {
        clearInterval(progressInterval);
        updateProgress(100);
        setTimeout(() => {
          const loadingScreen = document.getElementById('loading-screen');
          if (loadingScreen) {
            loadingScreen.style.opacity = '0';
            setTimeout(() => loadingScreen.remove(), 500);
          }
        }, 300);
      });
    `;
  }

  // For other styles, just hide on ready
  return `
    window.addEventListener('forge:engine-ready', () => {
      const loadingScreen = document.getElementById('loading-screen');
      if (loadingScreen) {
        loadingScreen.style.opacity = '0';
        setTimeout(() => loadingScreen.remove(), 500);
      }
    });
  `;
}
