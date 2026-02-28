/**
 * Embed Generator
 * Produces iframe-embeddable game HTML with postMessage bridge
 * for parent-page communication (ready, resize, state events).
 */

/**
 * Generate the postMessage bridge script injected into embed exports.
 * Communicates game lifecycle events to the parent frame.
 */
export function generatePostMessageBridge(): string {
  return `
// PostMessage bridge for iframe embedding
(function() {
  var isEmbedded = window.self !== window.top;
  if (!isEmbedded) return;

  // Notify parent that game frame is ready
  function sendToParent(type, data) {
    try {
      window.parent.postMessage({ source: 'forge-game', type: type, data: data || {} }, '*');
    } catch(e) {}
  }

  // Signal loading started
  sendToParent('loading');

  // Listen for engine ready
  window.addEventListener('forge:engine-ready', function() {
    sendToParent('ready', {
      width: window.innerWidth,
      height: window.innerHeight,
    });
  });

  // Report resize events
  window.addEventListener('resize', function() {
    sendToParent('resize', {
      width: window.innerWidth,
      height: window.innerHeight,
    });
  });

  // Listen for commands from parent
  window.addEventListener('message', function(event) {
    if (!event.data || event.data.source !== 'forge-host') return;
    var msg = event.data;

    if (msg.type === 'pause') {
      // Future: handle pause
    } else if (msg.type === 'resume') {
      // Future: handle resume
    } else if (msg.type === 'mute') {
      // Future: handle mute
    }
  });

  // Report errors to parent
  window.addEventListener('error', function(event) {
    sendToParent('error', { message: event.message || 'Unknown error' });
  });
})();
`;
}

/**
 * Generate an HTML embed code snippet the user can copy.
 */
export function generateEmbedSnippet(title: string, width: number, height: number): string {
  return `<iframe
  src="game.html"
  title="${escapeAttr(title)}"
  width="${width}"
  height="${height}"
  frameborder="0"
  allowfullscreen
  allow="autoplay; gamepad; fullscreen"
  sandbox="allow-scripts allow-same-origin allow-popups"
  style="border: none;"
></iframe>`;
}

/**
 * Generate a responsive embed snippet using aspect-ratio.
 */
export function generateResponsiveEmbedSnippet(title: string): string {
  return `<div style="position: relative; width: 100%; aspect-ratio: 16/9;">
  <iframe
    src="game.html"
    title="${escapeAttr(title)}"
    style="position: absolute; inset: 0; width: 100%; height: 100%; border: none;"
    allowfullscreen
    allow="autoplay; gamepad; fullscreen"
    sandbox="allow-scripts allow-same-origin allow-popups"
  ></iframe>
</div>`;
}

function escapeAttr(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
