import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/editor.fixture';
import { E2E_TIMEOUT_ELEMENT_MS, E2E_TIMEOUT_LOAD_MS } from '../constants';

/**
 * The quick-start plan review's layout, measured in a real browser (PR #10294).
 *
 * The review's plan and cost sit in the `@spawnforge/ui` Dialog body, the one
 * scroller. Its Build it / Discard plan row sits in the Dialog's footer,
 * OUTSIDE that scroll. jsdom has no layout, so the unit tests can only pin
 * that structure; this file measures what it buys.
 *
 * Rounds 3 and 4 pinned the row inside the body instead (`sticky`), and kept
 * focus clear of it with the body's scroll padding. Every defect below shipped
 * past the unit tests and was visible only here:
 *
 *  1. "Build it" took focus at open with the token total scrolled away.
 *  2. On a 320px-tall viewport the armed "Discard this plan?" and its "Keep
 *     plan" sat under the pinned row at every scroll offset.
 *  3. Firefox does not honour scroll padding for focus scrolling the way
 *     Chromium does, so Shift+Tab put "Keep plan" under the row there.
 *  4. The padding made every focus on Build it / Discard scroll the body: at
 *     open the review was already scrolled down, and Tab threw the reader back.
 *  5. A refused Build it's reason appeared out of view.
 *
 * So the properties asserted are layout facts no focus-scroll heuristic can
 * bend: the body is at the top at open; a Tab stop in the footer never moves
 * the body; every control that takes focus, the total, the discard question
 * and its answers, and a refusal's reason are inside the visible area and
 * not covered (hit-tested). Each case also asserts the condition that makes it
 * meaningful (the body overflows, the Tab cycle reached the control under
 * test), so a layout that stopped exercising a defect fails instead of
 * passing vacuously (lessons #9, #11).
 *
 * The plan comes from the store, not from the AI design step: that is the
 * substitution this file declares (#10158). The layout under test is the real
 * QuickStartDialog, opened from the real toolbar trigger. The refused build
 * is real too: `loadPage()` runs without the engine, so the slice's own
 * "editor is still loading" refusal answers Build it.
 */

/**
 * A phone, a landscape phone, a laptop, and two 320px-tall landscape phones
 * (667x320 and 568x320; 568x320 is an iPhone SE on its side), where the
 * previous layout had no scroll offset that showed the discard prompt.
 */
const VIEWPORTS = [
  { width: 375, height: 667 },
  { width: 740, height: 360 },
  { width: 1280, height: 720 },
  { width: 667, height: 320 },
  { width: 568, height: 320 },
] as const;

/**
 * The long plan's scene count. It overflows the body at every viewport above,
 * which each test asserts, so the scroll it exercises is real everywhere.
 */
const LONG_PLAN_SCENES = 12;

/** A short and a long plan. */
const SCENE_COUNTS = [1, LONG_PLAN_SCENES] as const;

/** Tab presses allowed to walk the dialog's whole focus cycle once. */
const MAX_TAB_STOPS = 20;

/** Half a pixel of slack for sub-pixel layout. */
const SLACK = 0.5;

/** What the page reports about one element. */
interface Placement {
  label: string;
  /** Px of the box outside what the user can see: the viewport, the dialog panel, and (in the body) its scrollport. */
  hidden: number;
  /** Whether the element is under another one at its centre (hit-tested). */
  covered: boolean;
  inFooter: boolean;
}

/**
 * Where focus is: on a control in the dialog (measured in `active`), on the
 * Dialog body itself (the scroll region, which is the scrollport rather than
 * content in it), or anywhere outside the dialog, <body> included. The last
 * one is a failure at every Tab stop: the dialog is modal and traps focus.
 */
type FocusKind = 'control' | 'body-region' | 'outside';

interface Snapshot {
  overflows: boolean;
  scrollTop: number;
  focus: FocusKind;
  active: Placement | null;
  total: Placement | null;
  question: Placement | null;
  alert: Placement | null;
  buttons: string[];
}

/** Runs in the page: measures the review against the viewport, the panel and the Dialog body. */
function measure(): Snapshot {
  // Found from the gate's action group outward: the compact editor layout
  // renders other role="dialog" drawers earlier in the document.
  const group = document.querySelector<HTMLElement>('[data-testid="approval-gate-actions"]');
  const dialog = group?.closest<HTMLElement>('[role="dialog"]');
  const body = dialog?.querySelector<HTMLElement>('[data-dialog-body]');
  const footer = dialog?.querySelector<HTMLElement>('[data-dialog-actions]');
  if (!group || !dialog || !body || !footer) throw new Error('plan review is not rendered');
  const b = body.getBoundingClientRect();
  const scrollport = { top: b.top + body.clientTop, bottom: b.top + body.clientTop + body.clientHeight };
  const panel = dialog.getBoundingClientRect();
  const outside = (top: number, bottom: number, box: DOMRect) =>
    Math.max(0, top - box.top) + Math.max(0, box.bottom - bottom);
  const place = (el: Element | null | undefined, label: string): Placement | null => {
    if (!el) return null;
    const box = el.getBoundingClientRect();
    let hidden = outside(0, window.innerHeight, box) + outside(panel.top, panel.bottom, box);
    if (body.contains(el) && el !== body) hidden += outside(scrollport.top, scrollport.bottom, box);
    const hit = document.elementFromPoint((box.left + box.right) / 2, (box.top + box.bottom) / 2);
    const covered = !hit || !(hit === el || el.contains(hit));
    return { label, hidden, covered, inFooter: footer.contains(el) };
  };
  const active = document.activeElement;
  // The body itself is a Tab stop while it overflows; it is the scrollport, not content in it.
  const focus: FocusKind =
    !active || !dialog.contains(active) ? 'outside' : active === body ? 'body-region' : 'control';
  return {
    overflows: body.scrollHeight - body.clientHeight > 1,
    scrollTop: body.scrollTop,
    focus,
    active:
      focus === 'control' && active
        ? place(active, (active.textContent ?? '').trim().slice(0, 40) || active.tagName)
        : null,
    total: place(dialog.querySelector('[data-testid="token-cost-total"]'), 'token total'),
    question: place(dialog.querySelector('[data-testid="discard-confirm-question"]'), 'discard question'),
    alert: place(body.querySelector('[role="alert"]'), 'refusal'),
    buttons: Array.from(group.querySelectorAll('button')).map((el) => (el.textContent ?? '').trim()),
  };
}

function expectInView(p: Placement | null, context: string) {
  expect(p, `${context}: not rendered`).not.toBeNull();
  expect(p?.hidden, `${context}: ${p?.label} outside the visible area`).toBeLessThanOrEqual(SLACK);
  expect(p?.covered, `${context}: ${p?.label} covered by another element`).toBe(false);
}

/** Seeds a designed plan awaiting "Build it", as `startQuickStart` leaves it. */
async function seedPlan(page: Page, scenes: number) {
  const seeded = await page.evaluate((sceneCount) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const store = (window as any).__EDITOR_STORE;
    const state = store?.getState?.();
    if (
      typeof state?.setPlan !== 'function' ||
      typeof state?.setOrchestratorStatus !== 'function' ||
      typeof state?.resetOrchestrator !== 'function'
    ) {
      return false;
    }
    // Clears the previous size's refusal, which `setPlan` leaves in place.
    state.resetOrchestrator();
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

/** Moves the body to the top, as a reader scrolling back up to Level 1 would. */
async function scrollBodyToTop(page: Page) {
  await page.evaluate(() => {
    const body = document
      .querySelector('[data-testid="approval-gate-actions"]')
      ?.closest('[role="dialog"]')
      ?.querySelector<HTMLElement>('[data-dialog-body]');
    if (body) body.scrollTop = 0;
  });
}

/**
 * Presses Tab through one whole focus cycle, until focus is back on
 * `startLabel`, and fails if it is not back there within MAX_TAB_STOPS.
 * Focus must stay in the dialog at every stop, every stop must be in view and
 * uncovered, the total must be in view at every stop (it is beside "Build it"
 * whenever Build it is reachable), and a stop in the footer must leave the
 * body exactly where it was.
 *
 * Each stop is read once the focused control has come into view (polled):
 * how soon a browser scrolls a Tab-focused element into view is not part of
 * the contract, and in CI WebKit's first reading was sometimes taken before
 * the scroll (PR #10294 board round 5). The Dialog body also reveals keyboard focus
 * itself now, so a control that never comes into view still fails here.
 */
async function walkTabCycle(page: Page, context: string, startLabel: string): Promise<string[]> {
  const visited: string[] = [];
  let closed = false;
  let before = (await page.evaluate(measure)).scrollTop;
  for (let i = 0; i < MAX_TAB_STOPS; i++) {
    await page.keyboard.press('Tab');
    const stop = `${context}, Tab ${i + 1}`;
    await expect
      .poll(
        async () => {
          const reading = await page.evaluate(measure);
          return reading.focus === 'control' ? (reading.active?.hidden ?? Number.POSITIVE_INFINITY) : 0;
        },
        { message: `${stop}: the focused control never came into view`, timeout: E2E_TIMEOUT_ELEMENT_MS },
      )
      .toBeLessThanOrEqual(SLACK);
    const s = await page.evaluate(measure);
    expect(s.focus, `${stop}: focus left the dialog`).not.toBe('outside');
    if (s.focus === 'control') expectInView(s.active, stop);
    expectInView(s.total, stop);
    if (s.active?.inFooter) {
      expect(s.scrollTop, `${stop}: focusing ${s.active.label} in the footer moved the body`).toBe(before);
    }
    before = s.scrollTop;
    const label = s.focus === 'body-region' ? '(the body region)' : (s.active?.label ?? '');
    if (label === startLabel) {
      closed = true;
      break;
    }
    visited.push(label);
  }
  expect(
    closed,
    `${context}: ${MAX_TAB_STOPS} Tab presses never returned to ${startLabel} (visited: ${visited.join(' > ')})`,
  ).toBe(true);
  return visited;
}

test.describe('Quick-start plan review layout @ui [substituted: AI game design]', {
  annotation: { type: 'substitution', description: 'AI game design' },
}, () => {
  for (const viewport of VIEWPORTS) {
    test(`keeps the review's buttons, total, discard question and refusal in view without moving the plan at ${viewport.width}x${viewport.height}`, async ({
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

        // (1) At open: the plan is read from the top, Build it has focus, and
        //     the total is beside it.
        const open = await page.evaluate(measure);
        overflowed ||= open.overflows;
        if (scenes === LONG_PLAN_SCENES) {
          expect(open.overflows, `${context}: the long plan does not overflow the body`).toBe(true);
        }
        expect(open.scrollTop, `${context}, at open: the body is scrolled`).toBe(0);
        expectInView(open.active, `${context}, at open`);
        expect(open.active?.label).toBe('Build it');
        expect(open.active?.inFooter, `${context}: Build it is not in the Dialog footer`).toBe(true);
        expectInView(open.total, `${context}, at open`);

        // (2) A whole Tab cycle back to Build it: every stop in view, footer
        //     stops never move the body, and the cycle reaches the balance
        //     warning's link in the body and Discard plan in the footer.
        const unarmed = await walkTabCycle(page, `${context}, unarmed`, 'Build it');
        expect(unarmed, `${context}: Tab never reached Buy tokens`).toContain('Buy tokens');
        expect(unarmed, `${context}: Tab never reached Discard plan`).toContain('Discard plan');

        // (3) A reader back at the top Tabs from Build it to Discard plan and
        //     arms it: the body stays at the top throughout.
        await scrollBodyToTop(page);
        await build.focus();
        await page.keyboard.press('Tab');
        const toDiscard = await page.evaluate(measure);
        expect(toDiscard.active?.label).toBe('Discard plan');
        expect(toDiscard.scrollTop, `${context}: Tab to Discard plan moved the body`).toBe(0);
        await page.keyboard.press('Enter');

        // (4) Armed: the row asks the question and offers its two answers, all
        //     in view, with focus on Keep plan (the button just pressed).
        const keep = dialog.getByRole('button', { name: 'Keep plan' });
        await expect(keep).toBeFocused({ timeout: E2E_TIMEOUT_ELEMENT_MS });
        const armed = await page.evaluate(measure);
        expect(armed.buttons, `${context}, armed`).toEqual(['Discard it', 'Keep plan']);
        expectInView(armed.question, `${context}, armed`);
        expectInView(armed.active, `${context}, armed`);
        expect(armed.scrollTop, `${context}, armed: arming moved the body`).toBe(0);
        await page.keyboard.press('Shift+Tab');
        const toDiscardIt = await page.evaluate(measure);
        expect(toDiscardIt.active?.label).toBe('Discard it');
        expectInView(toDiscardIt.active, `${context}, armed, Shift+Tab`);
        expect(toDiscardIt.scrollTop, `${context}, armed: Shift+Tab moved the body`).toBe(0);

        // Back out: Keep plan returns the review, focus stays on that button.
        await page.keyboard.press('Tab');
        await page.keyboard.press('Enter');
        const discardPlan = dialog.getByRole('button', { name: 'Discard plan' });
        await expect(discardPlan).toBeFocused({ timeout: E2E_TIMEOUT_ELEMENT_MS });

        // (5) A refused Build it (no engine here, so the slice refuses): its
        //     reason is brought into view in the body, focus is back on Build
        //     it, and the total is still beside it.
        await scrollBodyToTop(page);
        await build.focus();
        await page.keyboard.press('Enter');
        await expect(dialog.getByRole('alert'), `${context}: Build it was not refused`).toBeVisible({
          timeout: E2E_TIMEOUT_ELEMENT_MS,
        });
        await expect
          .poll(async () => (await page.evaluate(measure)).alert?.hidden ?? Number.POSITIVE_INFINITY, {
            message: `${context}, refused: the reason never came into view`,
            timeout: E2E_TIMEOUT_ELEMENT_MS,
          })
          .toBeLessThanOrEqual(SLACK);
        await expect(build).toBeFocused({ timeout: E2E_TIMEOUT_ELEMENT_MS });
        const refused = await page.evaluate(measure);
        expectInView(refused.alert, `${context}, refused`);
        expectInView(refused.active, `${context}, refused`);
        expectInView(refused.total, `${context}, refused`);

        // Close keeps the plan; the next size is seeded fresh.
        await page.keyboard.press('Escape');
        await expect(dialog).toBeHidden({ timeout: E2E_TIMEOUT_ELEMENT_MS });
      }
      // Non-vacuous: the long plan's overflow is asserted above at every
      // viewport; this also fails if SCENE_COUNTS ever loses the long plan.
      expect(overflowed, 'no plan overflowed the dialog body; the layout under test was not exercised').toBe(true);
    });
  }
});
