/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@/test/utils/componentTestUtils';
import { axe } from 'jest-axe';

vi.mock('@/hooks/useEngine', () => ({
  getActiveEngineBackend: vi.fn(),
  setPreferredBackend: vi.fn(),
}));

import { getActiveEngineBackend, setPreferredBackend } from '@/hooks/useEngine';
import { RenderErrorNotice, renderErrorNoticeActions } from '../RenderErrorNotice';
import { useRenderErrorStore } from '@/stores/renderErrorStore';
import { renderErrorCopy, type RenderErrorClass, type RenderErrorOutcome } from '@/lib/engine/renderErrorWire';

function report(errorClass: RenderErrorClass, outcome: RenderErrorOutcome, detail = 'wgpu: bind group layout mismatch') {
  act(() => {
    useRenderErrorStore.getState().report({ errorClass, outcome, detail, occurrence: 1 });
  });
}

const STOPPED_CASES = [
  ['validation', 'The viewport stopped drawing'],
  ['internal', 'The viewport stopped drawing'],
  ['outOfMemory', 'The graphics card ran out of memory'],
  ['deviceLost', 'The connection to the graphics card was lost'],
] as const;

describe('RenderErrorNotice', () => {
  let reload: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    useRenderErrorStore.getState().reset();
    vi.mocked(getActiveEngineBackend).mockReturnValue('webgpu');
    vi.mocked(setPreferredBackend).mockReset();
    reload = vi.spyOn(renderErrorNoticeActions, 'reload').mockImplementation(() => {});
  });

  afterEach(() => {
    reload.mockRestore();
    cleanup();
  });

  it('renders nothing until the engine reports an error', () => {
    const { container } = render(<RenderErrorNotice />);
    expect(container.innerHTML).toBe('');
  });

  it.each(STOPPED_CASES)('%s/stopped: an assertive alert with the exact copy', (errorClass, title) => {
    render(<RenderErrorNotice />);
    report(errorClass, 'stopped');

    const alert = screen.getByRole('alert');
    expect(alert.getAttribute('data-error-class')).toBe(errorClass);
    expect(screen.getByRole('heading', { name: title })).toBeDefined();
    expect(alert.textContent).toContain(renderErrorCopy(errorClass, 'stopped').body);
    // The raw wgpu text is only inside the collapsed disclosure, never the headline or body.
    const body = document.getElementById('render-error-body')!;
    expect(body.textContent).not.toContain('bind group');
    expect(alert.querySelector('details pre')?.textContent).toBe('wgpu: bind group layout mismatch');
    expect(alert.querySelector('details')?.hasAttribute('open')).toBe(false);
  });

  it.each(STOPPED_CASES)('%s/stopped: reload is offered and works; it cannot be dismissed', (errorClass) => {
    render(<RenderErrorNotice />);
    report(errorClass, 'stopped');

    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Reload editor' }));
    expect(reload).toHaveBeenCalledTimes(1);
    expect(setPreferredBackend).not.toHaveBeenCalled();
  });

  it('offers WebGL2 on WebGPU, and the switch persists the preference before reloading', () => {
    render(<RenderErrorNotice />);
    report('deviceLost', 'stopped');

    fireEvent.click(screen.getByRole('button', { name: 'Switch to WebGL2 and reload' }));
    expect(setPreferredBackend).toHaveBeenCalledWith('webgl2');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(vi.mocked(setPreferredBackend).mock.invocationCallOrder[0])
      .toBeLessThan(reload.mock.invocationCallOrder[0]);
  });

  it.each(['webgl2', 'unknown'] as const)('does not offer WebGL2 when the backend is %s', (backend) => {
    vi.mocked(getActiveEngineBackend).mockReturnValue(backend);
    render(<RenderErrorNotice />);
    report('outOfMemory', 'stopped');
    expect(screen.queryByRole('button', { name: 'Switch to WebGL2 and reload' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Reload editor' })).toBeDefined();
  });

  it.each(['validation', 'internal'] as const)('%s/continued: a polite status that can be dismissed', (errorClass) => {
    render(<RenderErrorNotice />);
    report(errorClass, 'continued');

    const status = screen.getByRole('status');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('heading', { name: 'A graphics error was skipped' })).toBeDefined();
    expect(status.textContent).toContain(renderErrorCopy(errorClass, 'continued').body);
    expect(screen.queryByRole('button', { name: 'Reload editor' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Switch to WebGL2 and reload' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('counts repeated skipped errors instead of stacking notices', () => {
    render(<RenderErrorNotice />);
    report('validation', 'continued');
    expect(screen.queryByText(/times this session/)).toBeNull();
    report('validation', 'continued');
    expect(screen.getByText('This has happened 2 times this session.')).toBeDefined();
    expect(screen.getAllByTestId('render-error-notice')).toHaveLength(1);
  });

  it('a stop after a skip replaces the skipped notice', () => {
    render(<RenderErrorNotice />);
    report('validation', 'continued');
    report('validation', 'stopped');
    expect(screen.getByRole('heading', { name: 'The viewport stopped drawing' })).toBeDefined();
    expect(screen.queryByRole('button', { name: 'Dismiss' })).toBeNull();
  });

  it('says so when the driver gave no message', () => {
    render(<RenderErrorNotice />);
    report('outOfMemory', 'stopped', '');
    expect(screen.getByRole('alert').querySelector('details pre')?.textContent).toBe('(none given)');
  });

  it('gives every action and the disclosure a 44px minimum target', () => {
    render(<RenderErrorNotice />);
    report('deviceLost', 'stopped');
    const targets = [
      ...screen.getAllByRole('button'),
      screen.getByText('Technical details'),
    ];
    expect(targets.length).toBe(3);
    for (const target of targets) {
      expect(target.className).toContain('min-h-[44px]');
    }
  });

  it('actions are native buttons, reachable by keyboard', () => {
    render(<RenderErrorNotice />);
    report('deviceLost', 'stopped');
    for (const button of screen.getAllByRole('button')) {
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('tabindex')).not.toBe('-1');
    }
  });

  it.each([
    ['deviceLost', 'stopped'],
    ['validation', 'continued'],
  ] as const)('has no axe violations (%s/%s)', async (errorClass, outcome) => {
    const { container } = render(<RenderErrorNotice />);
    report(errorClass, outcome);
    expect(screen.getByTestId('render-error-notice')).toBeDefined();
    const results = await axe(container);
    expect(results.violations.map((v) => v.id)).toEqual([]);
  });
});
