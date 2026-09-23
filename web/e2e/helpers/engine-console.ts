import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * The console line `editorStore`'s `tracked` dispatcher wrapper writes when the
 * engine refuses a command (`reportCommandRejected` in
 * `src/stores/editorStore.ts`). Unthrottled: only the Sentry report is deduped.
 */
export const ENGINE_REJECTION_MARKER = 'Engine rejected command';

/**
 * What a live-engine spec collects for the whole lifetime of its page.
 *
 * A HARD-REJECTED dispatch is observable almost nowhere: store actions and the
 * pipeline's `dispatchCommand` return `void`, so a payload the engine refuses
 * leaves the caller looking healthy and surfaces only as the
 * {@link ENGINE_REJECTION_MARKER} console line. Page errors are collected
 * alongside it because an uncaught exception on the command path would
 * likewise leave every store action looking successful.
 *
 * Warnings are DIAGNOSTICS only, never asserted on: the engine answers an
 * unknown entity id at `warn`, not `error`, so the errors alone cannot show the
 * most useful line when a step fails to find its entity.
 */
export interface EngineConsole {
  readonly consoleErrors: string[];
  readonly consoleWarnings: string[];
  readonly pageErrors: string[];
  /** Console-error lines naming an engine rejection. */
  rejections(): string[];
  /**
   * Up to `limit` error or warning lines that describe the engine refusing or
   * ignoring something — for failure messages, never for assertions.
   */
  complaints(limit?: number): string[];
}

/**
 * Start collecting. Call BEFORE the first navigation so the collection covers
 * engine boot as well as the test body.
 */
export function collectEngineConsole(page: Page): EngineConsole {
  const consoleErrors: string[] = [];
  const consoleWarnings: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
    if (msg.type() === 'warning') consoleWarnings.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(err.message));
  return {
    consoleErrors,
    consoleWarnings,
    pageErrors,
    rejections: () => consoleErrors.filter((line) => line.includes(ENGINE_REJECTION_MARKER)),
    complaints: (limit = 20) =>
      [...consoleErrors, ...consoleWarnings]
        .filter((line) => /Engine rejected command|no entity with id|ignored/.test(line))
        .slice(0, limit),
  };
}

/**
 * The one assertion that can see a hard-rejected dispatch: ZERO rejection lines
 * and ZERO page errors. Console errors that do NOT name a rejection are
 * tolerated on purpose — an unrelated third-party or React warning must not
 * redden a gate about engine payloads.
 */
export function expectNoEngineRejections(collected: EngineConsole): void {
  expect(collected.rejections(), 'the engine rejected a command').toEqual([]);
  expect(collected.pageErrors, 'the page threw').toEqual([]);
}
