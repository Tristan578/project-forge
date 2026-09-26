// @vitest-environment node
import { describe, it, expect } from 'vitest';
import {
  RENDER_ERROR_CLASSES,
  parseRenderErrorReport,
  renderErrorCopy,
  type RenderErrorClass,
} from '../renderErrorWire';

describe('parseRenderErrorReport', () => {
  it('accepts every class the engine can send, with both outcomes', () => {
    for (const errorClass of RENDER_ERROR_CLASSES) {
      for (const outcome of ['continued', 'stopped'] as const) {
        const payload = { errorClass, outcome, detail: 'd', occurrence: 2 };
        expect(parseRenderErrorReport(payload)).toEqual(payload);
      }
    }
  });

  it('accepts an empty detail (wgpu gives out-of-memory none)', () => {
    expect(parseRenderErrorReport({ errorClass: 'outOfMemory', outcome: 'stopped', detail: '', occurrence: 1 }))
      .toEqual({ errorClass: 'outOfMemory', outcome: 'stopped', detail: '', occurrence: 1 });
  });

  it.each([
    ['null', null],
    ['an array', []],
    ['a string', 'RENDER_ERROR'],
    ['an unknown class', { errorClass: 'lost', outcome: 'stopped', detail: '', occurrence: 1 }],
    ['snake_case class', { errorClass: 'device_lost', outcome: 'stopped', detail: '', occurrence: 1 }],
    ['an unknown outcome', { errorClass: 'validation', outcome: 'quit', detail: '', occurrence: 1 }],
    ['a missing detail', { errorClass: 'validation', outcome: 'stopped', occurrence: 1 }],
    ['a zero occurrence', { errorClass: 'validation', outcome: 'stopped', detail: '', occurrence: 0 }],
    ['a fractional occurrence', { errorClass: 'validation', outcome: 'stopped', detail: '', occurrence: 1.5 }],
    ['a string occurrence', { errorClass: 'validation', outcome: 'stopped', detail: '', occurrence: '1' }],
  ])('rejects %s', (_label, payload) => {
    expect(parseRenderErrorReport(payload)).toBeNull();
  });
});

describe('renderErrorCopy', () => {
  const SAVE_THEN_RELOAD =
    'Your scene is still loaded, so save your work from the toolbar first, then reload the editor.';

  it('says a skipped error left the scene unchanged', () => {
    for (const errorClass of ['validation', 'internal'] as const) {
      expect(renderErrorCopy(errorClass, 'continued')).toEqual({
        title: 'A graphics error was skipped',
        body:
          'The viewport hit a graphics error and skipped drawing one frame. Your scene is unchanged and you can keep working. ' +
          'If the viewport looks wrong, save your work and reload the editor.',
      });
    }
  });

  it('explains a repeated error that stopped the viewport', () => {
    for (const errorClass of ['validation', 'internal'] as const) {
      expect(renderErrorCopy(errorClass, 'stopped')).toEqual({
        title: 'The viewport stopped drawing',
        body:
          'The same graphics error kept happening, so the engine stopped drawing the viewport to avoid flicker. ' +
          SAVE_THEN_RELOAD,
      });
    }
  });

  it('explains out of memory', () => {
    expect(renderErrorCopy('outOfMemory', 'stopped')).toEqual({
      title: 'The graphics card ran out of memory',
      body:
        'The viewport stopped drawing because the graphics card ran out of memory. ' +
        `${SAVE_THEN_RELOAD} Closing other tabs or apps that use graphics can free memory.`,
    });
  });

  it('explains a lost device', () => {
    expect(renderErrorCopy('deviceLost', 'stopped')).toEqual({
      title: 'The connection to the graphics card was lost',
      body:
        'The viewport stopped drawing because the browser lost its graphics device. This can happen after a driver update, ' +
        `waking from sleep, or a graphics crash. ${SAVE_THEN_RELOAD}`,
    });
  });

  it('never puts a wgpu term in a title or body', () => {
    const outcomes = ['continued', 'stopped'] as const;
    let checked = 0;
    for (const errorClass of RENDER_ERROR_CLASSES as readonly RenderErrorClass[]) {
      for (const outcome of outcomes) {
        const { title, body } = renderErrorCopy(errorClass, outcome);
        expect(`${title} ${body}`).not.toMatch(/wgpu|validation|pipeline|bind group|RenderError/i);
        checked += 1;
      }
    }
    expect(checked).toBe(8);
  });
});
