import { describe, it, expect } from 'vitest';
import {
  CWV_MARKETING_LCP_MS,
  CWV_MARKETING_INP_MS,
  CWV_MARKETING_CLS,
  CWV_EDITOR_LCP_MS,
  CWV_EDITOR_INP_MS,
  CWV_EDITOR_CLS,
  BUNDLE_FIRST_LOAD_WARN,
  BUNDLE_FIRST_LOAD_FAIL,
  BUNDLE_TOTAL_WARN,
  BUNDLE_TOTAL_FAIL,
  WASM_BINARY_WARN,
  WASM_BINARY_FAIL,
  WASM_COLD_LOAD_MS,
  WASM_WARM_LOAD_MS,
  EDITOR_TTI_LOCAL_MS,
  EDITOR_TTI_CI_MS,
  EDITOR_ENGINE_READY_LOCAL_MS,
  EDITOR_ENGINE_READY_CI_MS,
} from '../performanceTargets';

describe('performanceTargets ordering invariants', () => {
  it('bundle warn < fail for first-load JS', () => {
    expect(BUNDLE_FIRST_LOAD_WARN).toBeLessThan(BUNDLE_FIRST_LOAD_FAIL);
  });

  it('bundle warn < fail for total JS', () => {
    expect(BUNDLE_TOTAL_WARN).toBeLessThan(BUNDLE_TOTAL_FAIL);
  });

  it('first-load fail <= total warn (first-load is a subset of total)', () => {
    expect(BUNDLE_FIRST_LOAD_FAIL).toBeLessThanOrEqual(BUNDLE_TOTAL_WARN);
  });

  it('WASM binary warn < fail', () => {
    expect(WASM_BINARY_WARN).toBeLessThan(WASM_BINARY_FAIL);
  });

  it('WASM warm load < cold load', () => {
    expect(WASM_WARM_LOAD_MS).toBeLessThan(WASM_COLD_LOAD_MS);
  });

  it('editor TTI local < CI (CI runners are slower)', () => {
    expect(EDITOR_TTI_LOCAL_MS).toBeLessThan(EDITOR_TTI_CI_MS);
  });

  it('editor engine ready local < CI', () => {
    expect(EDITOR_ENGINE_READY_LOCAL_MS).toBeLessThan(EDITOR_ENGINE_READY_CI_MS);
  });

  it('marketing LCP <= editor LCP (editor has WASM overhead)', () => {
    expect(CWV_MARKETING_LCP_MS).toBeLessThanOrEqual(CWV_EDITOR_LCP_MS);
  });

  it('marketing CLS <= editor CLS (editor has panel resizes)', () => {
    expect(CWV_MARKETING_CLS).toBeLessThanOrEqual(CWV_EDITOR_CLS);
  });

  it('INP targets are equal across surfaces', () => {
    expect(CWV_MARKETING_INP_MS).toBe(CWV_EDITOR_INP_MS);
  });
});

describe('performanceTargets values are positive', () => {
  it('all CWV targets are positive', () => {
    expect(CWV_MARKETING_LCP_MS).toBeGreaterThan(0);
    expect(CWV_MARKETING_INP_MS).toBeGreaterThan(0);
    expect(CWV_MARKETING_CLS).toBeGreaterThan(0);
    expect(CWV_EDITOR_LCP_MS).toBeGreaterThan(0);
  });

  it('all bundle thresholds are positive', () => {
    expect(BUNDLE_FIRST_LOAD_WARN).toBeGreaterThan(0);
    expect(BUNDLE_TOTAL_FAIL).toBeGreaterThan(0);
    expect(WASM_BINARY_WARN).toBeGreaterThan(0);
  });
});
