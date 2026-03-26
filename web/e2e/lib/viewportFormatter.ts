/**
 * Markdown formatters for agent viewport observations and verification results.
 *
 * These functions convert structured `ViewportObservation` and `VerificationResult`
 * objects into human-readable markdown strings that AI agents can reason about.
 */

import type { ViewportObservation, VerificationResult } from './types';

/**
 * Formats a `ViewportObservation` as a markdown string suitable for agent
 * reasoning. Includes scene summary, entity list, viewport status, and
 * any console errors.
 *
 * @param obs - The observation to format.
 * @returns Markdown string.
 */
export function formatObservation(obs: ViewportObservation): string {
  const lines: string[] = [];
  const capturedAt = new Date(obs.capturedAt).toISOString();

  lines.push(`## Viewport Observation${obs.label ? ` — ${obs.label}` : ''}`);
  lines.push(`Captured at: ${capturedAt}`);
  lines.push('');

  // Scene summary
  lines.push('### Scene');
  lines.push(`- Mode: **${obs.scene.engineMode}**`);
  lines.push(`- Scene name: **${obs.scene.sceneName}**`);
  lines.push(`- Entity count: **${obs.scene.entityCount}**`);
  lines.push(`- Selected: **${obs.scene.selectedIds.length > 0 ? obs.scene.selectedIds.join(', ') : 'none'}**`);
  lines.push('');

  // Entity list
  if (obs.scene.entityCount > 0) {
    lines.push('### Entities');
    const sortedIds = obs.scene.rootIds.slice().sort();
    for (const id of sortedIds) {
      const node = obs.scene.nodes[id];
      if (!node) continue;
      const visIcon = node.visible ? '' : ' *(hidden)*';
      const childCount = node.children.length;
      const childStr = childCount > 0 ? ` (${childCount} child${childCount !== 1 ? 'ren' : ''})` : '';
      lines.push(`- **${node.name}** [${node.type}]${visIcon}${childStr} — id: \`${id}\``);
    }
    // Also list non-root entities under their parents
    const nonRootIds = Object.keys(obs.scene.nodes).filter(
      (id) => !obs.scene.rootIds.includes(id),
    );
    if (nonRootIds.length > 0) {
      for (const id of nonRootIds) {
        const node = obs.scene.nodes[id];
        if (!node) continue;
        const visIcon = node.visible ? '' : ' *(hidden)*';
        lines.push(`  - **${node.name}** [${node.type}]${visIcon} — id: \`${id}\` (child of \`${node.parentId ?? 'unknown'}\`)`);
      }
    }
    lines.push('');
  }

  // Viewport status
  lines.push('### Viewport');
  lines.push(`- Backend: **${obs.viewport.backend}**`);
  lines.push(`- Dimensions: **${obs.viewport.width}×${obs.viewport.height}**`);
  lines.push(`- Blank frame: **${obs.viewport.isBlank ? 'yes (engine may not have rendered yet)' : 'no'}**`);
  if (obs.viewport.dataUrl && obs.viewport.dataUrl.length > 0) {
    lines.push(`- Frame captured: **yes** (${Math.round(obs.viewport.dataUrl.length / 1024)} KB data URL)`);
  } else {
    lines.push('- Frame captured: **no** (canvas unavailable or tainted)');
  }
  lines.push('');

  // Console errors
  if (obs.consoleErrors.length > 0) {
    lines.push('### Console Errors');
    for (const err of obs.consoleErrors) {
      lines.push(`- \`${err}\``);
    }
    lines.push('');
  } else {
    lines.push('### Console Errors');
    lines.push('- None');
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Formats a `VerificationResult` as a short markdown summary with pass/fail
 * status and supporting evidence.
 *
 * @param result - The verification result to format.
 * @returns Markdown string.
 */
export function formatVerificationResult(result: VerificationResult): string {
  const lines: string[] = [];
  const status = result.passed ? 'PASS' : 'FAIL';

  lines.push(`## Verification: ${status}`);
  lines.push('');
  lines.push(`**Reason:** ${result.reason}`);
  lines.push('');

  if (result.evidence.sceneSnapshot) {
    const snap = result.evidence.sceneSnapshot;
    lines.push('**Scene evidence:**');
    lines.push(`- ${snap.entityCount} entities, mode: ${snap.engineMode}`);
    lines.push(`- Selected: ${snap.selectedIds.length > 0 ? snap.selectedIds.join(', ') : 'none'}`);
    lines.push('');
  }

  if (result.evidence.viewport) {
    const vp = result.evidence.viewport;
    lines.push('**Viewport evidence:**');
    lines.push(`- ${vp.width}×${vp.height} via ${vp.backend}`);
    lines.push(`- Blank: ${vp.isBlank ? 'yes' : 'no'}`);
    lines.push('');
  }

  return lines.join('\n');
}
