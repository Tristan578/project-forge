/**
 * Interactive property editing E2E tests — PF-E2E-PROPERTY-EDITING
 *
 * Verifies the critical gap: editing a property in the inspector actually
 * updates Zustand store state. These tests use the WASM engine and require
 * GPU-capable Chromium (tagged @engine).
 *
 * Design principles:
 * - Every assertion reads back concrete state, not just "no error thrown".
 * - Store reads are done via waitForFunction to tolerate async event round-trips.
 * - No test passes if the store value is undefined / null — we require a real value.
 * - Tests that cannot prove correctness without GPU round-trips are clearly scoped
 *   to what can be proven in headless CI (optimistic store writes on input change).
 * - Tests skip (rather than vacuously pass) when expected UI elements are not found.
 */

import type { Page } from '@playwright/test';
import { test, expect, EditorPage } from '../fixtures/editor.fixture';
import {
  E2E_TIMEOUT_ELEMENT_MS,
  E2E_TIMEOUT_INTERACTION_MS,
  E2E_TIMEOUT_LOAD_MS,
} from '../constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Read the full Zustand editor store state. */
async function getStoreState(page: Page) {
  return page.evaluate(() => (window as unknown as { __EDITOR_STORE?: { getState: () => unknown } }).__EDITOR_STORE?.getState());
}

/** Spawn a cube and wait for the scene graph to have at least 2 nodes (Camera + Cube). */
async function spawnCubeAndSelect(page: Page, editor: EditorPage) {
  await page.getByRole('button', { name: 'Add Entity' }).click();
  await page.getByText('Cube', { exact: true }).click();
  await editor.waitForEntityCount(2);
  await editor.selectEntity('Cube');

  // Wait for selection to be reflected in the store
  await page.waitForFunction(
    () => {
      const store = (window as unknown as { __EDITOR_STORE?: { getState: () => { selectedIds: Set<string> } } }).__EDITOR_STORE;
      return store && store.getState().selectedIds.size > 0;
    },
    { timeout: E2E_TIMEOUT_LOAD_MS },
  );
}

/** Return the currently selected primary entity ID from the store, or null. */
async function getPrimaryEntityId(page: Page): Promise<string | null> {
  return page.evaluate((): string | null => {
    const store = (window as unknown as { __EDITOR_STORE?: { getState: () => { selectedIds: Set<string> } } }).__EDITOR_STORE;
    if (!store) return null;
    const ids = [...store.getState().selectedIds] as string[];
    return ids[0] ?? null;
  });
}

// ---------------------------------------------------------------------------
// Group 1: Transform Editing
// ---------------------------------------------------------------------------

test.describe('Group 1: Transform Editing @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('selecting a cube makes the Transform section visible in the inspector', async ({
    page,
    editor,
  }) => {
    await spawnCubeAndSelect(page, editor);

    const transformHeading = page.getByText('Transform', { exact: false });
    await expect(transformHeading.first()).toBeVisible({ timeout: E2E_TIMEOUT_INTERACTION_MS });

    // X, Y, Z labels must be present — proves the inspector rendered position fields
    await expect(page.getByText('X', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Y', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Z', { exact: true }).first()).toBeVisible();
  });

  test('editing X position input updates primaryTransform in the store', async ({
    page,
    editor,
  }) => {
    await spawnCubeAndSelect(page, editor);

    // Record the entity id so we can correlate store reads
    const entityId = await getPrimaryEntityId(page);
    expect(entityId).not.toBeNull();

    // The transform section contains Vec3 inputs for position (first group).
    // We locate the input via its proximity to the "X" label to avoid depending
    // on nth-child ordering which can change if the inspector layout changes.
    const transformSection = page.getByText('Transform', { exact: false }).first().locator('..');
    const xInput = transformSection.locator('input').first();
    await expect(xInput).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    // Fill in a distinctive value that is unlikely to be the default
    await xInput.click({ clickCount: 3 });
    await xInput.fill('7.5');
    await xInput.press('Enter');

    // The inspector wires input onChange/onBlur → store.updateTransform → dispatchCommand.
    // updateTransform does an optimistic write to primaryTransform immediately (before any
    // WASM round-trip). We verify that optimistic write here.
    await page.waitForFunction(
      () => {
        const store = (window as unknown as { __EDITOR_STORE?: { getState: () => { primaryTransform?: { position?: number[] } } } }).__EDITOR_STORE;
        if (!store) return false;
        const t = store.getState().primaryTransform;
        // primaryTransform.position[0] should be approximately 7.5
        return t && typeof t.position?.[0] === 'number' && Math.abs(t.position[0] - 7.5) < 0.1;
      },
      { timeout: E2E_TIMEOUT_ELEMENT_MS },
    );

    const state = await getStoreState(page) as { primaryTransform?: { position?: number[] } } | undefined;
    const transform = state?.primaryTransform;

    expect(transform).not.toBeNull();
    expect(typeof transform!.position![0]).toBe('number');
    expect(Math.abs(transform!.position![0] - 7.5)).toBeLessThan(0.1);
  });

  test('editing Y and Z position inputs both update the store', async ({
    page,
    editor,
  }) => {
    await spawnCubeAndSelect(page, editor);

    // Locate position row by the "Position" label (Vec3Input renders a row label)
    // then target inputs within that row. Fall back to transform section inputs if
    // the Position label is not present.
    const transformSection = page.getByText('Transform', { exact: false }).first().locator('..');

    // Try label-based approach first: find the Position row and its Y/Z inputs
    const positionRow = transformSection.locator('text=Position').first().locator('..').locator('..');
    const positionRowInputCount = await positionRow.locator('input').count().catch(() => 0);

    let yInput: ReturnType<Page['locator']>;
    let zInput: ReturnType<Page['locator']>;

    if (positionRowInputCount >= 3) {
      // Within the position row: X=0, Y=1, Z=2
      yInput = positionRow.locator('input').nth(1);
      zInput = positionRow.locator('input').nth(2);
    } else {
      // Fallback: use transform section — position occupies inputs 0-2
      const inputs = transformSection.locator('input');
      const inputCount = await inputs.count();
      expect(inputCount).toBeGreaterThanOrEqual(3);
      yInput = inputs.nth(1);
      zInput = inputs.nth(2);
    }

    await yInput.click({ clickCount: 3 });
    await yInput.fill('3.0');
    await yInput.press('Enter');

    await zInput.click({ clickCount: 3 });
    await zInput.fill('-2.5');
    await zInput.press('Enter');

    // Wait for both values to appear in the store
    await page.waitForFunction(
      () => {
        const store = (window as unknown as { __EDITOR_STORE?: { getState: () => { primaryTransform?: { position?: number[] } } } }).__EDITOR_STORE;
        if (!store) return false;
        const t = store.getState().primaryTransform;
        if (!t) return false;
        const yOk = typeof t.position?.[1] === 'number' && Math.abs(t.position[1] - 3.0) < 0.1;
        const zOk = typeof t.position?.[2] === 'number' && Math.abs(t.position[2] - (-2.5)) < 0.1;
        return yOk && zOk;
      },
      { timeout: E2E_TIMEOUT_ELEMENT_MS },
    );

    const state = await getStoreState(page) as { primaryTransform?: { position?: number[] } } | undefined;
    const transform = state?.primaryTransform;

    expect(transform).not.toBeNull();
    expect(Math.abs(transform!.position![1] - 3.0)).toBeLessThan(0.1);
    expect(Math.abs(transform!.position![2] - (-2.5))).toBeLessThan(0.1);
  });

  test('editing a rotation input updates primaryTransform.rotation in the store', async ({
    page,
    editor,
  }) => {
    await spawnCubeAndSelect(page, editor);

    // Use the data-testid added to the Rotation Vec3Input for reliable targeting
    const rotationRow = page.locator('[data-testid="vec3-rotation"]');
    await expect(rotationRow).toBeVisible({ timeout: E2E_TIMEOUT_INTERACTION_MS });
    const rotXInput = rotationRow.locator('input').first();

    // Capture the rotation value BEFORE editing so we can detect a real change.
    const beforeRotState = await getStoreState(page) as { primaryTransform?: { rotation?: number[] } } | undefined;
    const beforeRot = beforeRotState?.primaryTransform?.rotation?.[0] ?? null;

    await rotXInput.click({ clickCount: 3 });
    await rotXInput.fill('45');
    await rotXInput.press('Enter');

    // Wait for rotation[0] to actually CHANGE from its pre-edit value AND land near 45° or 0.785 rad.
    // This prevents a false positive where the default value (0) already satisfies a loose tolerance.
    await page.waitForFunction(
      ([before]: [number | null]) => {
        const store = (window as unknown as { __EDITOR_STORE?: { getState: () => { primaryTransform?: { rotation?: number[] } } } }).__EDITOR_STORE;
        if (!store) return false;
        const t = store.getState().primaryTransform;
        if (!t || !Array.isArray(t.rotation) || t.rotation.length < 1) return false;
        const val = t.rotation[0];
        // Must have changed from its initial value
        if (before !== null && val === before) return false;
        // Must be close to 45 degrees OR close to 0.785398 radians (strict tolerance)
        return Math.abs(val - 45) < 1.0 || Math.abs(val - 0.785398) < 0.1;
      },
      [beforeRot] as [number | null],
      { timeout: E2E_TIMEOUT_LOAD_MS },
    );

    const state = await getStoreState(page) as { primaryTransform?: { rotation?: number[] } } | undefined;
    const transform = state?.primaryTransform;

    expect(transform).not.toBeNull();
    expect(Array.isArray(transform!.rotation)).toBe(true);
    expect(transform!.rotation!.length).toBe(3);

    // rotation[0] must be close to 45 degrees (strict) OR close to 0.785398 radians (strict).
    // Tolerance of 1.0 for degrees, 0.1 for radians — tight enough that default 0 cannot satisfy either.
    const rotVal = transform!.rotation![0];
    const inDegrees = Math.abs(rotVal - 45) < 1.0;
    const inRadians = Math.abs(rotVal - 0.785398) < 0.1;
    expect(inDegrees || inRadians).toBe(true);
  });

  test('editing a scale input updates primaryTransform.scale in the store', async ({
    page,
    editor,
  }) => {
    await spawnCubeAndSelect(page, editor);

    // Use the data-testid added to the Scale Vec3Input for reliable targeting
    const scaleRow = page.locator('[data-testid="vec3-scale"]');
    await expect(scaleRow).toBeVisible({ timeout: E2E_TIMEOUT_INTERACTION_MS });
    const scaleXInput = scaleRow.locator('input').first();

    await scaleXInput.click({ clickCount: 3 });
    await scaleXInput.fill('2.0');
    await scaleXInput.press('Enter');

    await page.waitForFunction(
      () => {
        const store = (window as unknown as { __EDITOR_STORE?: { getState: () => { primaryTransform?: { scale?: number[] } } } }).__EDITOR_STORE;
        if (!store) return false;
        const t = store.getState().primaryTransform;
        return t && Array.isArray(t.scale) && Math.abs(t.scale[0] - 2.0) < 0.1;
      },
      { timeout: E2E_TIMEOUT_ELEMENT_MS },
    );

    const state = await getStoreState(page) as { primaryTransform?: { scale?: number[] } } | undefined;
    const transform = state?.primaryTransform;

    expect(transform).not.toBeNull();
    expect(Math.abs(transform!.scale![0] - 2.0)).toBeLessThan(0.1);
  });
});

// ---------------------------------------------------------------------------
// Group 2: Material Editing
// ---------------------------------------------------------------------------

test.describe('Group 2: Material Editing @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('selecting a cube makes the Material section visible in the inspector', async ({
    page,
    editor,
  }) => {
    await spawnCubeAndSelect(page, editor);

    const materialHeading = page.getByText(/material/i, { exact: false }).first();
    await expect(materialHeading).toBeVisible({ timeout: E2E_TIMEOUT_INTERACTION_MS });
  });

  test('changing metallic input dispatches update_material and updates the store', async ({
    page,
    editor,
  }) => {
    await spawnCubeAndSelect(page, editor);

    const entityId = await getPrimaryEntityId(page);
    expect(entityId).not.toBeNull();

    // Capture the current primaryMaterial before editing
    const beforeState = await getStoreState(page) as { primaryMaterial?: { metallic?: number } } | undefined;
    const beforeMetallic = beforeState?.primaryMaterial?.metallic ?? null;

    // Find the metallic label and its sibling input
    const metallicLabel = page.locator('text=/metallic/i').first();
    await expect(metallicLabel).toBeVisible({ timeout: E2E_TIMEOUT_INTERACTION_MS });

    const metallicInput = metallicLabel.locator('..').locator('input').first();
    await expect(metallicInput).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    await metallicInput.click({ clickCount: 3 });
    await metallicInput.fill('0.85');
    await metallicInput.press('Enter');

    // The updateMaterial slice action writes to primaryMaterial immediately.
    // We wait for the value to change from its pre-edit state.
    await page.waitForFunction(
      (beforeVal: number | null) => {
        const store = (window as unknown as { __EDITOR_STORE?: { getState: () => { primaryMaterial?: { metallic?: number } } } }).__EDITOR_STORE;
        if (!store) return false;
        const mat = store.getState().primaryMaterial;
        if (!mat) return false;
        // Verify metallic changed AND is close to what we typed
        const changed = beforeVal === null || Math.abs((mat.metallic ?? 0) - beforeVal) > 0.01;
        const correct = Math.abs((mat.metallic ?? 0) - 0.85) < 0.05;
        return changed && correct;
      },
      beforeMetallic,
      { timeout: E2E_TIMEOUT_ELEMENT_MS },
    );

    const afterState = await getStoreState(page) as { primaryMaterial?: { metallic?: number } } | undefined;
    const materialAfter = afterState?.primaryMaterial;

    expect(materialAfter).not.toBeNull();
    expect(Math.abs((materialAfter!.metallic ?? 0) - 0.85)).toBeLessThan(0.05);
  });

  test('changing roughness input updates primaryMaterial.perceptualRoughness in the store', async ({
    page,
    editor,
  }) => {
    await spawnCubeAndSelect(page, editor);

    await page.waitForFunction(
      () => {
        const store = (window as unknown as { __EDITOR_STORE?: { getState: () => { selectedIds: Set<string> } } }).__EDITOR_STORE;
        return store && store.getState().selectedIds.size > 0;
      },
      { timeout: E2E_TIMEOUT_LOAD_MS },
    );

    const roughnessLabel = page.locator('text=/roughness/i').first();
    await expect(roughnessLabel).toBeVisible({ timeout: E2E_TIMEOUT_INTERACTION_MS });

    const roughnessInput = roughnessLabel.locator('..').locator('input').first();
    await expect(roughnessInput).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    await roughnessInput.click({ clickCount: 3 });
    await roughnessInput.fill('0.25');
    await roughnessInput.press('Enter');

    await page.waitForFunction(
      () => {
        const store = (window as unknown as { __EDITOR_STORE?: { getState: () => { primaryMaterial?: { perceptualRoughness?: number } } } }).__EDITOR_STORE;
        if (!store) return false;
        const mat = store.getState().primaryMaterial;
        return mat && Math.abs((mat.perceptualRoughness ?? 0) - 0.25) < 0.05;
      },
      { timeout: E2E_TIMEOUT_ELEMENT_MS },
    );

    const state = await getStoreState(page) as { primaryMaterial?: { perceptualRoughness?: number } } | undefined;
    const material = state?.primaryMaterial;

    expect(material).not.toBeNull();
    expect(Math.abs((material!.perceptualRoughness ?? 0) - 0.25)).toBeLessThan(0.05);
  });

  test('clicking a material preset changes primaryMaterial properties in the store', async ({
    page,
    editor,
  }) => {
    await spawnCubeAndSelect(page, editor);

    const entityId = await getPrimaryEntityId(page);
    expect(entityId).not.toBeNull();

    // Record state before clicking a preset
    const beforeState = await getStoreState(page) as { primaryMaterial?: { metallic?: number; perceptualRoughness?: number; baseColor?: number[] } } | undefined;
    const before = beforeState?.primaryMaterial ?? null;

    // Look for a material preset button — the material library uses named presets
    const presetBtn = page.locator('button').filter({ hasText: /metal|plastic|wood|glass|stone/i }).first();
    await expect(presetBtn).toBeVisible({ timeout: E2E_TIMEOUT_INTERACTION_MS });

    await presetBtn.click();

    // After clicking a preset, primaryMaterial should have changed
    await page.waitForFunction(
      (beforeJson: string | null) => {
        const store = (window as unknown as { __EDITOR_STORE?: { getState: () => { primaryMaterial?: { metallic?: number; perceptualRoughness?: number; baseColor?: number[] } } } }).__EDITOR_STORE;
        if (!store) return false;
        const mat = store.getState().primaryMaterial;
        if (!mat) return false;
        if (beforeJson === null) return true; // no prior material — any data is progress
        const beforeParsed = JSON.parse(beforeJson) as { metallic?: number; perceptualRoughness?: number; baseColor?: number[] };
        // Verify at least one key-value pair changed
        return (
          mat.metallic !== beforeParsed.metallic ||
          mat.perceptualRoughness !== beforeParsed.perceptualRoughness ||
          JSON.stringify(mat.baseColor) !== JSON.stringify(beforeParsed.baseColor)
        );
      },
      before ? JSON.stringify(before) : null,
      { timeout: E2E_TIMEOUT_ELEMENT_MS },
    );

    const afterState = await getStoreState(page) as { primaryMaterial?: unknown } | undefined;
    expect(afterState?.primaryMaterial).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Group 3: Physics Toggle
// ---------------------------------------------------------------------------

test.describe('Group 3: Physics Toggle @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('physics section is visible in the inspector after selecting a cube', async ({
    page,
    editor,
  }) => {
    await spawnCubeAndSelect(page, editor);

    const physicsSection = page.getByText(/physics/i, { exact: false }).first();
    await expect(physicsSection).toBeVisible({ timeout: E2E_TIMEOUT_INTERACTION_MS });
  });

  test('toggling physics enabled checkbox changes physicsEnabled in the store', async ({
    page,
    editor,
  }) => {
    await spawnCubeAndSelect(page, editor);

    // Wait for physics section to render
    await expect(page.getByText(/physics/i).first()).toBeVisible({ timeout: E2E_TIMEOUT_INTERACTION_MS });

    // Capture initial state — physicsEnabled starts false for newly spawned entities
    const initialState = await getStoreState(page) as { physicsEnabled?: boolean } | undefined;
    const initialEnabled = initialState?.physicsEnabled ?? null;

    // Find the physics enable/disable toggle — scoped to the Physics section to avoid
    // matching the Material "Double Sided" checkbox (or any other page-level checkbox).
    const physicsSectionHeading = page.getByText(/physics/i).first();
    // Walk up to the section container, then scope the checkbox search within it.
    const physicsSectionContainer = physicsSectionHeading.locator('..').locator('..');
    const physicsToggle = physicsSectionContainer
      .locator('[role="checkbox"], input[type="checkbox"]')
      .first();
    await expect(physicsToggle).toBeVisible({ timeout: E2E_TIMEOUT_INTERACTION_MS });

    const wasChecked = await physicsToggle.isChecked();
    await physicsToggle.click();

    // Wait for the store's physicsEnabled to flip
    await page.waitForFunction(
      (was: boolean) => {
        const store = (window as unknown as { __EDITOR_STORE?: { getState: () => { physicsEnabled?: boolean } } }).__EDITOR_STORE;
        if (!store) return false;
        return store.getState().physicsEnabled !== was;
      },
      wasChecked,
      { timeout: E2E_TIMEOUT_ELEMENT_MS },
    );

    const nowState = await getStoreState(page) as { physicsEnabled?: boolean } | undefined;
    const nowEnabled = nowState?.physicsEnabled ?? null;

    // physicsEnabled must have actually changed
    expect(nowEnabled).not.toBe(initialEnabled);
  });
});

// ---------------------------------------------------------------------------
// Group 4: Store Round-Trip Verification
// ---------------------------------------------------------------------------

test.describe('Group 4: Store Round-Trip Verification @engine', () => {
  test.beforeEach(async ({ editor }) => {
    await editor.load();
  });

  test('position edit via inspector matches value read back from store', async ({
    page,
    editor,
  }) => {
    await spawnCubeAndSelect(page, editor);

    const entityId = await getPrimaryEntityId(page);
    expect(entityId).not.toBeNull();

    // Edit position X via the inspector input
    const transformSection = page.getByText('Transform', { exact: false }).first().locator('..');
    const xInput = transformSection.locator('input').first();
    await expect(xInput).toBeVisible({ timeout: E2E_TIMEOUT_ELEMENT_MS });

    const targetValue = 4.5;
    await xInput.click({ clickCount: 3 });
    await xInput.fill(String(targetValue));
    await xInput.press('Enter');

    // 1. Store must have the value
    await page.waitForFunction(
      (expected: number) => {
        const store = (window as unknown as { __EDITOR_STORE?: { getState: () => { primaryTransform?: { position?: number[] } } } }).__EDITOR_STORE;
        if (!store) return false;
        const t = store.getState().primaryTransform;
        return t && typeof t.position?.[0] === 'number' && Math.abs(t.position[0] - expected) < 0.1;
      },
      targetValue,
      { timeout: E2E_TIMEOUT_ELEMENT_MS },
    );

    const state = await getStoreState(page) as { primaryTransform?: { position?: number[] } } | undefined;
    const storeValue = state?.primaryTransform?.position?.[0] ?? null;

    expect(storeValue).not.toBeNull();
    expect(Math.abs((storeValue as number) - targetValue)).toBeLessThan(0.1);

    // 2. The input's current display value should match what was typed
    //    (verifies the inspector doesn't re-render with a stale/wrong value)
    const inputDisplayValue = await xInput.inputValue();
    expect(parseFloat(inputDisplayValue)).toBeCloseTo(targetValue, 1);
  });

  test('dispatchCommand can be called and primaryTransform.position updates to the dispatched value', async ({
    page,
    editor,
  }) => {
    await spawnCubeAndSelect(page, editor);

    const entityId = await getPrimaryEntityId(page);
    expect(entityId).not.toBeNull();

    // Dispatch a transform update through the public dispatchCommand API —
    // the same path used by every MCP command and chat handler.
    const dispatchResult = await page.evaluate((eid: string): boolean => {
      const store = (window as unknown as { __EDITOR_STORE?: { getState: () => { dispatchCommand: (cmd: string, args: unknown) => void; selectedIds: Set<string> } } }).__EDITOR_STORE;
      if (!store) return false;
      try {
        store.getState().dispatchCommand('update_transform', {
          entityId: eid,
          position: [1.0, 2.0, 3.0],
        });
        return true;
      } catch {
        return false;
      }
    }, entityId as string);

    // dispatchCommand must not throw
    expect(dispatchResult).toBe(true);

    // Wait for the optimistic store write to propagate — tolerance 0.1 for WASM round-trips
    await page.waitForFunction(
      () => {
        const store = (window as unknown as { __EDITOR_STORE?: { getState: () => { primaryTransform?: { position?: number[] } } } }).__EDITOR_STORE;
        if (!store) return false;
        const t = store.getState().primaryTransform;
        if (!t || !Array.isArray(t.position)) return false;
        return (
          Math.abs(t.position[0] - 1.0) < 0.1 &&
          Math.abs(t.position[1] - 2.0) < 0.1 &&
          Math.abs(t.position[2] - 3.0) < 0.1
        );
      },
      { timeout: E2E_TIMEOUT_ELEMENT_MS },
    );

    const state = await getStoreState(page) as { primaryTransform?: { position?: number[] }; selectedIds?: Set<string> } | undefined;
    const transform = state?.primaryTransform;

    expect(transform).not.toBeNull();
    expect(Math.abs(transform!.position![0] - 1.0)).toBeLessThan(0.1);
    expect(Math.abs(transform!.position![1] - 2.0)).toBeLessThan(0.1);
    expect(Math.abs(transform!.position![2] - 3.0)).toBeLessThan(0.1);

    // Selection must still be valid after the dispatch
    const selectionValid = await page.evaluate((eid: string) => {
      const store = (window as unknown as { __EDITOR_STORE?: { getState: () => { selectedIds: Set<string> } } }).__EDITOR_STORE;
      return store ? store.getState().selectedIds.has(eid) : false;
    }, entityId as string);

    expect(selectionValid).toBe(true);
  });
});
