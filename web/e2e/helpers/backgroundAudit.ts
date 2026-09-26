/**
 * Audit unconditional Tailwind background-color utilities only. State/responsive
 * variants are not active merely because their class exists; image/position and
 * intentionally transparent utilities make no opaque-color promise.
 * Self-contained so Playwright can serialize it into page.evaluate.
 */
export function auditBackgroundColors() {
  const missing: Array<{ tag: string; classes: string }> = [];
  let checked = 0;
  const nonColor = /^bg-(?:transparent|inherit|current|none|auto|cover|contain|fixed|local|scroll|clip-.+|origin-.+|repeat.*|no-repeat|center|top|bottom|left|right|size-.+|position-.+|gradient-.+|linear-.+|radial.*|conic.*)$/;
  for (const el of document.querySelectorAll<HTMLElement>('[class*="bg-"]')) {
    if (el.offsetWidth === 0 || el.offsetHeight === 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.visibility === 'collapse') continue;
    const classes = [...el.classList].map((token) => token.replace(/^!|!$/g, ''));
    // Explicit transparency can override another background class intentionally.
    if (classes.some((token) => /^bg-(?:transparent|inherit|current)$/.test(token) || (token.startsWith('bg-') && /\/0$/.test(token)))) continue;
    const colors = classes.filter((token) => token.startsWith('bg-') && !nonColor.test(token)
      && !/^bg-\[(?:url|image|position|size|length|linear-gradient|radial-gradient|conic-gradient)/.test(token));
    if (colors.length === 0) continue;
    checked++;
    if (style.backgroundColor === 'transparent' || style.backgroundColor === 'rgba(0, 0, 0, 0)') {
      missing.push({ tag: el.tagName.toLowerCase(), classes: el.className });
    }
  }
  return { checked, missing };
}
