import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/editor.fixture';
import { E2E_TIMEOUT_ELEMENT_MS, E2E_TIMEOUT_LOAD_MS } from '../constants';

/**
 * The quick-start plan review's layout, measured in a real browser (PR #10294).
 *
 * The review sits in the `@spawnforge/ui` Dialog body, the one scroller, and
 * its Build it / Discard row is `sticky bottom-0` to that body. jsdom has no
 * layout, so the unit tests can only pin structure. Three defects that shipped
 * past them were visible only here, with real key presses in Chromium:
 *
 *  1. "Build it" takes focus at open while the token cost scrolled away under
 *     the pinned row: one Enter from spending with the total out of view. The
 *     total now rides in the pinned row (`TokenCostTotal`).
 *  2. Arming Discard inserted "Discard this plan?" and "Keep plan" under or
 *     below the row. The review now scrolls the prompt into view.
 *  3. Tab landed on "Keep plan" / "Buy tokens" underneath the row: Chromium
 *     scrolls a focused control only when it is outside the scrollport, and
 *     the strip under a sticky row is inside it. The gate now keeps the body's
 *     scroll padding at the height that row covers.
 *
 * Every assertion is a geometry measurement against the rendered page. Each
 * case also asserts the condition that makes it meaningful (the body overflows,
 * the Tab cycle reached the control under test), so a layout that stopped
 * exercising the defect fails instead of passing vacuously (lessons #9, #11).
 *
 * The plan comes from the store, not from the AI design step: that is the
 * substitution this file declares (#10158). The layout under test is the real
 * QuickStartDialog, opened from the real toolbar trigger.
 */

/** The three viewports the board measured: a phone, a landscape phone, a laptop. */
const VIEWPORTS = [
  { width: 375, height: 667 },
  { width: 740, height: 360 },
  { width: 1280, height: 720 },
] as const;

/** A short and a long plan: the long one overflows the body at every viewport above. */
const SCENE_COUNTS = [1, 12] as const;

/** Tab presses allowed to walk the dialog's whole focus cycle once. */
const MAX_TAB_STOPS = 20;

interface Box {
  top: number;
  bottom: number;
}

/** What the page reports about one element. */
interface Placement {
  label: string;
  box: Box;
  /** Part of the box outside the body's scrollport, in px. */
  outsideScrollport: number;
  /** Part of the box under the pinned action row, in px (0 for the row's own content). */
  underRow: number;
}

interface Snapshot {
  overflows: boolean;
  scrollport: Box;
  row: Box;
  active: Placement | null;
  activeInBody: boolean;
  total: Placement | null;
  prompt: Placement | null;
  keep: Placement | null;
}

/** Runs in the page: measures the review against the Dialog body and the pinned row. */
function measure(): Snapshot {
  // Found from the row outward: the compact editor layout renders other
  // role="dialog" drawers earlier in the document.
  const row = document.querySelector<HTMLElement>('[data-testid="approval-gate-actions"]');
  const body = row?.closest<HTMLElement>('[data-dialog-body]');
  const dialog = row?.closest('[role="dialog"]');
  if (!dialog || !body || !row) throw new Error('plan review is not rendered');
  const b = body.getBoundingClientRect();
  const scrollport = { top: b.top + body.clientTop, bottom: b.top + body.clientTop + body.clientHeight };
  const r = row.getBoundingClientRect();
  const place = (el: Element | null | undefined, label: string): Placement | null => {
    if (!el) return null;
    const box = el.getBoundingClientRect();
    const outsideScrollport =
      Math.max(0, scrollport.top - box.top) + Math.max(0, box.bottom - scrollport.bottom);
    const underRow = row.contains(el) ? 0 : Math.max(0, Math.min(box.bottom, r.bottom) - Math.max(box.top, r.top));
    return { label, box: { top: box.top, bottom: box.bottom }, outsideScrollport, underRow };
  };
  const active = document.activeElement;
  const promptText = Array.from(dialog.querySelectorAll('span')).find((s) =>
    s.textContent?.startsWith('Discard this plan?'),
  );
  const keep = Array.from(dialog.querySelectorAll('button')).find((el) => el.textContent?.trim() === 'Keep plan');
  return {
    overflows: body.scrollHeight - body.clientHeight > 1,
    scrollport,
    row: { top: r.top, bottom: r.bottom },
    active: active ? place(active, (active.textContent ?? '').trim().slice(0, 40) || active.tagName) : null,
    activeInBody: !!active && active !== body && body.contains(active),
    total: place(dialog.querySelector('[data-testid="token-cost-total"]'), 'token total'),
    prompt: place(promptText, 'discard prompt'),
    keep: place(keep, 'Keep plan'),
  };
}

/** Half a pixel of slack for sub-pixel layout. */
const SLACK = 0.5;

function expectFullyVisible(p: Placement | null, context: string) {
  expect(p, `${context}: not rendered`).not.toBeNull();
  expect(p?.outsideScrollport, `${context}: ${p?.label} outside the body's visible area`).toBeLessThanOrEqual(SLACK);
  expect(p?.underRow, `${context}: ${p?.label} under the pinned row`).toBeLessThanOrEqual(SLACK);
}

/** Seeds a designed plan awaiting "Build it", as `startQuickStart` leaves it. */
async function seedPlan(page: Page, scenes: number) {
  const seeded = await page.evaluate((sceneCount) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).__EDITOR_STORE;
    const state = store?.getState?.();
    if (typeof state?.setPlan !== 'function' || typeof state?.setOrchestratorStatus !== 'function') return false;
    state.setPlan({
      id: `e2e-layout-plan-${sceneCount}`,
      projectId: 'e2e-layout',
      prompt: 'collect every crystal to win',
      gdd: {
        id: 'e2e-layout-gdd',
        title: 'Layout plan',
        description: 'A plan sized to overflow the dialog body',
        systems: [],
        scenes: [],
        assetManifest: [],
        estimatedScope: 'small',
        styleDirective: 'default',
        feelDirective: { mood: 'fun', pacing: 'medium', weight: 'medium', referenceGames: [], oneLiner: 'test' },
        constraints: [],
        projectType: '3d',
      },
      steps: [],
      approvalGates: [
        {
          id: 'gate_plan',
          label: 'Review your game plan',
          description: 'Check the plan and its cost before building starts.',
          afterStepId: '',
          status: 'pending',
          displayData: {
            sceneSummaries: Array.from({ length: sceneCount }, (_, i) => ({
              name: `Level ${i + 1}`,
              entityCount: 3,
              systemDescriptions: [],
            })),
          },
        },
      ],
      // Short balance: the tallest review, with the warning and its Buy tokens link.
      tokenEstimate: {
        breakdown: [
          { category: 'Scenes', estimatedTokens: 100, variance: 10 },
          { category: 'Assets', estimatedTokens: 200, variance: 10 },
          { category: 'Scripts', estimatedTokens: 40, variance: 5 },
        ],
        totalEstimated: 340,
        totalVarianceHigh: 400,
        totalVarianceLow: 300,
        userTier: 'starter',
        sufficientBalance: false,
      },
      status: 'awaiting_approval',
      currentStepIndex: 0,
      createdAt: Date.now(),
    });
    state.setOrchestratorStatus('awaiting_approval');
    return true;
  }, scenes);
  expect(seeded, 'window.__EDITOR_STORE is missing: build with NEXT_PUBLIC_E2E_HOOKS=true').toBe(true);
}

/** Presses Tab through one whole focus cycle, asserting each stop inside the body is in view. */
async function walkTabCycle(page: Page, context: string): Promise<string[]> {
  const visited: string[] = [];
  for (let i = 0; i < MAX_TAB_STOPS; i++) {
    await page.keyboard.press('Tab');
    const s = await page.evaluate(measure);
    expect(s.active, `${context}: focus left the page`).not.toBeNull();
    const label = s.active?.label ?? '';
    if (s.activeInBody) expectFullyVisible(s.active, `${context}, Tab ${i + 1}`);
    // The total must be in view whenever "Build it" is reachable: at every stop.
    expectFullyVisible(s.total, `${context}, Tab ${i + 1}`);
    if (label === 'Build it' && visited.length > 0) break;
    visited.push(label);
  }
  return visited;
}

test.describe('Quick-start plan review layout @ui [substituted: AI game design]', {
  annotation: { type: 'substitution', description: 'AI game design' },
}, () => {
  for (const viewport of VIEWPORTS) {
    test(`keeps the total, the discard prompt and every Tab stop clear of the pinned row at ${viewport.width}x${viewport.height}`, async ({
      page,
      editor,
    }) => {
      await page.setViewportSize(viewport);
      await editor.loadPage();
      await editor.waitForEditorStore(E2E_TIMEOUT_LOAD_MS);

      let overflowed = false;
      for (const scenes of SCENE_COUNTS) {
        const context = `${viewport.width}x${viewport.height}, ${scenes} scene(s)`;
        await seedPlan(page, scenes);
        await page.getByTestId('quick-start-trigger').first().click();
        const dialog = page.getByRole('dialog', { name: 'Make me a game' });
        const build = dialog.getByRole('button', { name: 'Build it' });
        // The dialog is a lazy() chunk: the first open can wait on its load.
        await expect(build).toBeVisible({ timeout: E2E_TIMEOUT_LOAD_MS });
        await expect(build).toBeFocused({ timeout: E2E_TIMEOUT_ELEMENT_MS });

        // (1) At open, focus is on "Build it" and the total is in view beside it.
        const open = await page.evaluate(measure);
        overflowed ||= open.overflows;
        expectFullyVisible(open.total, `${context}, at open`);
        expect(open.total?.label).toBe('token total');

        // (3) Every Tab stop inside the body is in view, and the cycle reaches the
        //     balance warning's link (the control that used to land under the row).
        const unarmed = await walkTabCycle(page, `${context}, unarmed`);
        expect(unarmed, `${context}: Tab never reached Buy tokens`).toContain('Buy tokens');

        // (2) Arming Discard brings the prompt and "Keep plan" into view above the row.
        await dialog.getByRole('button', { name: 'Discard plan' }).focus();
        await page.keyboard.press('Enter');
        await expect(dialog.getByRole('button', { name: 'Keep plan' })).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });
        await expect
          .poll(async () => (await page.evaluate(measure)).prompt?.underRow ?? Number.POSITIVE_INFINITY, {
            message: `${context}, armed: the discard prompt never cleared the pinned row`,
            timeout: E2E_TIMEOUT_ELEMENT_MS,
          })
          .toBeLessThanOrEqual(SLACK);
        const armed = await page.evaluate(measure);
        expectFullyVisible(armed.prompt, `${context}, armed`);
        expectFullyVisible(armed.keep, `${context}, armed`);
        expectFullyVisible(armed.total, `${context}, armed`);

        // (3) again with the prompt in place: Tab onto "Keep plan" in both directions.
        const forward = await walkTabCycle(page, `${context}, armed`);
        expect(forward, `${context}: Tab never reached Keep plan`).toContain('Keep plan');
        await dialog.getByRole('button', { name: 'Discard it' }).focus();
        let reachedKeep = false;
        for (let i = 0; i < MAX_TAB_STOPS && !reachedKeep; i++) {
          await page.keyboard.press('Shift+Tab');
          const s = await page.evaluate(measure);
          if (s.activeInBody) expectFullyVisible(s.active, `${context}, armed, Shift+Tab ${i + 1}`);
          reachedKeep = s.active?.label === 'Keep plan';
        }
        expect(reachedKeep, `${context}: Shift+Tab never reached Keep plan`).toBe(true);

        // Close keeps the plan; the next size is seeded fresh.
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden({ timeout: E2E_TIMEOUT_ELEMENT_MS });
      }
      // Non-vacuous: at least the long plan overflowed the body, so the pinned
      // row was actually covering content at this viewport.
      expect(overflowed, 'no plan overflowed the dialog body; the layout under test was not exercised').toBe(true);
    });
  }
});
