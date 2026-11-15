import type { Page } from '@playwright/test';
import type { useEditorStore } from '@/stores/editorStore';
import { test, expect } from '../fixtures/editor.fixture';
import { E2E_TIMEOUT_SHORT_MS } from '../constants';
import { SCENE_EXPORTED_EVENT } from '../../src/lib/engine/sceneExportWire';

type Store = typeof useEditorStore;
interface Quality {
  preset: string;
  msaaSamples: number;
  shadowsEnabled: boolean;
  shadowsDirectionalOnly: boolean;
  bloomEnabled: boolean;
  chromaticAberrationEnabled: boolean;
  sharpeningEnabled: boolean;
  particleDensityScale: number;
}
type ObservedWindow = Window & { qualityEvents: Quality[] };
interface Scene { quality: Quality; [key: string]: unknown }

const HIGH: Quality = {
  preset: 'high', msaaSamples: 4, shadowsEnabled: true,
  shadowsDirectionalOnly: false, bloomEnabled: true,
  chromaticAberrationEnabled: true, sharpeningEnabled: true, particleDensityScale: 1,
};
const LOW: Quality = {
  preset: 'low', msaaSamples: 1, shadowsEnabled: false,
  shadowsDirectionalOnly: false, bloomEnabled: false,
  chromaticAberrationEnabled: false, sharpeningEnabled: false, particleDensityScale: 0.25,
};
const ULTRA: Quality = { ...HIGH, preset: 'ultra', particleDensityScale: 1.5 };

async function dispatch(page: Page, command: string, payload: Record<string, unknown> = {}) {
  expect(await page.evaluate(({ command, payload }) =>
    window.__FORGE_DISPATCH?.(command, payload), { command, payload })).toBe(true);
}

async function exportScene(page: Page): Promise<Scene> {
  const json = await page.evaluate(({ eventName, timeout }) => new Promise<string>((resolve, reject) => {
    const requestId = crypto.randomUUID();
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<{ json: string; requestId?: string }>).detail;
      if (detail.requestId !== requestId) return;
      clearTimeout(timer);
      window.removeEventListener(eventName, listener);
      resolve(detail.json);
    };
    const timer = window.setTimeout(() => {
      window.removeEventListener(eventName, listener);
      reject(new Error('Quality regression: engine scene export timed out'));
    }, timeout);
    window.addEventListener(eventName, listener);
    if (window.__FORGE_DISPATCH?.('export_scene', { requestId }) !== true) {
      clearTimeout(timer);
      window.removeEventListener(eventName, listener);
      reject(new Error('Quality regression: no live engine dispatcher'));
    }
  }), { eventName: SCENE_EXPORTED_EVENT, timeout: E2E_TIMEOUT_SHORT_MS });
  return JSON.parse(json) as Scene;
}

async function changeAndObserve(page: Page, command: string, payload: Record<string, unknown>, quality: Quality) {
  await page.evaluate(() => { (window as ObservedWindow).qualityEvents = []; });
  await dispatch(page, command, payload);
  // This callback is reached only through QUALITY_CHANGED. No optimistic store
  // action or get_quality_settings query can manufacture the expected result.
  await expect.poll(() => page.evaluate(() => (window as ObservedWindow).qualityEvents.at(-1))).toEqual(quality);
  await expect.poll(() => page.evaluate(() => (window.__EDITOR_STORE as Store).getState().qualityPreset)).toBe(quality.preset);
  expect((await exportScene(page)).quality).toEqual(quality);
}

test('quality commands, undo, save/load and reset reach the engine and editor mirror @engine-smoke', async ({ page, editor }) => {
  await editor.load();
  await page.evaluate(() => {
    const store = window.__EDITOR_STORE as Store;
    const original = store.getState().setQualityFromEngine;
    (window as ObservedWindow).qualityEvents = [];
    store.setState({ setQualityFromEngine: (data) => {
      (window as ObservedWindow).qualityEvents.push(structuredClone(data) as Quality);
      original(data);
    } });
  });

  await changeAndObserve(page, 'new_scene', {}, HIGH);
  await changeAndObserve(page, 'set_quality_preset', { preset: 'low' }, LOW);
  const savedLow = await exportScene(page); // production exporter, never hand-assigned
  await changeAndObserve(page, 'set_quality_preset', { preset: 'ultra' }, ULTRA);
  await changeAndObserve(page, 'undo', {}, LOW); // command must have recorded history

  await dispatch(page, 'set_quality_preset', { preset: 'low' });
  await exportScene(page); // engine frame barrier before testing the redo stack
  await changeAndObserve(page, 'redo', {}, ULTRA); // exact no-op must preserve redo
  await changeAndObserve(page, 'load_scene', { json: JSON.stringify(savedLow) }, LOW);
  await changeAndObserve(page, 'new_scene', {}, HIGH);

  // A valid imported profile can share a preset name but contain other values.
  // Selecting High must apply its full canonical profile, not skip by label.
  const customHigh: Quality = { ...HIGH, msaaSamples: 1, particleDensityScale: 0.25 };
  const customScene = { ...savedLow, quality: customHigh };
  await changeAndObserve(page, 'load_scene', { json: JSON.stringify(customScene) }, customHigh);
  await changeAndObserve(page, 'set_quality_preset', { preset: 'high' }, HIGH);
  await changeAndObserve(page, 'undo', {}, customHigh);
  await changeAndObserve(page, 'redo', {}, HIGH);
});
