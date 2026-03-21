# UX Quality Standards

SpawnForge is "Canva for games." The editor competes with native desktop apps. Every pixel matters.

## First-Time Experience
- Empty states show actionable prompts, not blank canvases
- AI chat responses show friendly progress, not raw tool names
- Error messages explain what happened AND what to do next
- Tooltips on every toolbar button and inspector field

## Visual Consistency
- Color scale: `zinc-*` everywhere (zinc-900 bg, zinc-800 panels, zinc-700 borders) — NOT `gray-*`
- Font: system monospace for values, system sans for labels
- Spacing: Tailwind spacing scale only (no arbitrary values unless essential)
- Transitions: `transition-colors duration-150` on interactive elements
- Focus rings: `focus:ring-2 focus:ring-blue-500` on all focusable elements
- Rounded corners: `rounded` or `rounded-md` consistently

## Performance
- Virtual scrolling for lists > 50 items (use `useVirtualList` hook)
- Lazy load heavy components (shader editor, visual scripting, asset panels)
- Debounce inspector inputs (100ms for sliders, 300ms for text)
- Never re-render the entire editor — Zustand selectors must be granular
- Use `reduce()` not `Math.max(...arr)` for unbounded arrays (RangeError)

## Accessibility
- All interactive elements must be keyboard-navigable
- ARIA labels on icon-only buttons
- Color contrast ratio >= 4.5:1 for text
- Focus trap in modals and dialogs
- Screen reader announcements for state changes
- `role="dialog"` + `aria-labelledby` on all modals
- `role="tablist"` + `aria-selected` on tab interfaces

## Responsive Layout
- Three breakpoints: compact (mobile), condensed (tablet), full (desktop)
- Use `useResponsiveLayout` hook for layout mode detection
- Drawer panels on compact, side panels on full
- Canvas always gets priority space
