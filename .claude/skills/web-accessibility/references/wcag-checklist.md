# WCAG 2.1 AA Checklist — Game Editor Context

## Keyboard Navigation (2.1.1, 2.1.2)
- [ ] All interactive elements reachable via Tab/Shift+Tab
- [ ] Scene hierarchy tree navigable with Arrow keys
- [ ] Inspector panels switchable via Tab key on tab headers
- [ ] Modal dialogs trap focus (Tab cycles within dialog)
- [ ] Escape key closes modals and dropdown menus
- [ ] No keyboard traps — user can always Tab away
- [ ] Canvas area has skip link or bypass mechanism
- [ ] Keyboard shortcuts documented and discoverable

## Focus Management (2.4.3, 2.4.7)
- [ ] Focus visible on all interactive elements (2px+ outline)
- [ ] Focus moves logically through the page
- [ ] Focus returns to trigger element when dialog closes
- [ ] Focus moves to new content when panels open/close
- [ ] No focus loss when elements are removed from DOM

## Color & Contrast (1.4.3, 1.4.11)
- [ ] Text contrast ratio ≥ 4.5:1 (normal text)
- [ ] Text contrast ratio ≥ 3:1 (large text, 18px+ or 14px+ bold)
- [ ] UI component contrast ≥ 3:1 against adjacent colors
- [ ] Color is not the only means of conveying information
- [ ] Active/selected states distinguishable without color alone
- [ ] Dark theme tokens meet contrast requirements

## Screen Reader Support (1.1.1, 1.3.1, 4.1.2)
- [ ] All images have alt text (or alt="" for decorative)
- [ ] Form inputs have associated labels
- [ ] Icon-only buttons have `aria-label`
- [ ] Status messages use `aria-live` regions
- [ ] Error messages associated with inputs via `aria-describedby`
- [ ] Canvas has `role="img"` with descriptive `aria-label`

## Component Patterns
- [ ] Tree view (scene hierarchy): `role="tree"`, `role="treeitem"`, `aria-expanded`
- [ ] Tab panels (inspector): `role="tablist"`, `role="tab"`, `role="tabpanel"`, `aria-selected`
- [ ] Toolbar (scene toolbar): `role="toolbar"`, arrow key navigation
- [ ] Dialog (export/settings): `role="dialog"`, `aria-modal="true"`, `aria-labelledby`
- [ ] Alert dialog (delete confirm): `role="alertdialog"`
- [ ] Dropdown select: `role="listbox"`, `role="option"`, `aria-selected`

## Motion & Animation (2.3.1, 2.3.3)
- [ ] Respect `prefers-reduced-motion` media query
- [ ] Theme ambient effects (EmberGlow, etc.) honor reduced motion
- [ ] No content flashes more than 3 times per second
