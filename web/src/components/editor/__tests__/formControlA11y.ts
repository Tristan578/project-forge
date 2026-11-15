/**
 * Shared assertions for the editor form-control accessibility suites (#9677).
 *
 * The suites render a panel with every toggle switched on, so the controls
 * that an E2E axe pass would miss behind a disabled effect or a collapsed
 * section are in the DOM, and then run the same axe engine the E2E audit uses.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect } from 'vitest';
import { axe } from 'jest-axe';
import { scanControls } from './controlNameScan';

const EDITOR_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

type Violation = { id: string; impact?: string | null; help?: string };

/** One line per rule, so a failure names the rule rather than a count. */
function describeViolation(v: Violation): string {
  return `[${v.impact ?? 'unknown'}] ${v.id}: ${v.help ?? ''}`;
}

/** Every labelable form control under `root`. */
export function formControls(root: ParentNode): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('input:not([type="hidden"]), select, textarea'),
  );
}

/** The colour/range/select controls axe's `label` / `select-name` rules cover. */
export function colourRangeSelect(root: ParentNode): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>('input[type="color"], input[type="range"], select'),
  );
}

/**
 * How many colour/range/select controls the static scan finds in one editor
 * source file. A runtime suite that renders exactly this many has exercised
 * every such control in the file, not a convenient subset.
 */
export function staticControlCount(fileName: string): number {
  const file = path.join(EDITOR_DIR, fileName);
  return scanControls(fileName, readFileSync(file, 'utf8')).length;
}

/** Assert every labelable control has a non-empty accessible name. */
export function expectEveryControlNamed(root: ParentNode): void {
  const controls = formControls(root);
  expect(controls.length).toBeGreaterThan(0);
  for (const control of controls) {
    expect(control, control.outerHTML.slice(0, 160)).toHaveAccessibleName();
  }
}

/**
 * Assert every `<label for>` under `root` names a labelable element that is
 * in the tree right now.
 *
 * HTML requires `for` to be the id of a labelable element in the same tree.
 * A label pointing at a control that is conditionally absent (a slider hidden
 * behind an "Infinite" switch, a select replaced by an Upload button) names
 * nothing. axe has no rule for a dangling `for`, and a control-centric check
 * cannot see it because the missing control is not there to check, so this
 * walks the labels instead. `HTMLLabelElement.control` is the spec's own
 * resolution: null when `for` names no element, or a non-labelable one.
 */
export function expectEveryLabelForResolves(root: ParentNode): void {
  const labels = Array.from(root.querySelectorAll<HTMLLabelElement>('label[for]'));
  // A walk over zero labels would pass vacuously (lessons-learned #9).
  expect(labels.length).toBeGreaterThan(0);
  const dangling = labels
    .filter((label) => label.control === null)
    .map((label) => `for="${label.htmlFor}": ${(label.textContent ?? '').trim()}`);
  expect(dangling, 'labels whose `for` names no rendered labelable element').toEqual([]);
}

/**
 * Run axe over `root` and return one `[impact] rule: help` line per
 * violation, so `expect(await axeViolations(el)).toEqual([])` fails naming
 * the rules rather than printing a bare count.
 */
export async function axeViolations(root: Element): Promise<string[]> {
  const results = await axe(root);
  return results.violations.map(describeViolation);
}
