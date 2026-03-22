/**
 * Screenshot utility — takes screenshots of the SpawnForge editor canvas
 * from multiple camera angles using Playwright.
 */

import { chromium, type Browser, type Page } from 'playwright';
import { mkdirSync, existsSync } from 'fs';
import { resolve } from 'path';
import { config } from '../autoforge.config.js';

let browser: Browser | null = null;
let page: Page | null = null;

/**
 * Initialize the headless browser and navigate to the dev route.
 */
export async function initBrowser(): Promise<void> {
  if (browser) return;

  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    deviceScaleFactor: 1,
  });
  page = await context.newPage();

  // Navigate to dev route (bypasses Clerk auth)
  const url = `${config.devServerUrl}${config.devRoute}`;
  await page.goto(url, { waitUntil: 'networkidle' });

  // Wait for WASM engine to initialize
  await page.waitForFunction(
    () => {
      const w = window as unknown as { __spawnforge_ready?: boolean };
      return w.__spawnforge_ready === true;
    },
    { timeout: 60000 }
  );
}

/**
 * Execute a compound action via the editor's command dispatch.
 * Returns the scene state after execution.
 */
export async function executeCompoundAction(
  actionName: string,
  args: Record<string, unknown>
): Promise<unknown> {
  if (!page) throw new Error('Browser not initialized. Call initBrowser() first.');

  // Dispatch command through the editor store
  const result = await page.evaluate(
    ({ action, actionArgs }) => {
      const store = (window as unknown as { __editorStore?: { getState: () => unknown } })
        .__editorStore;
      if (!store) throw new Error('Editor store not found on window');

      const state = store.getState() as {
        dispatchCommand?: (cmd: string, args: string) => Promise<unknown>;
      };
      if (!state.dispatchCommand) throw new Error('dispatchCommand not found');

      return state.dispatchCommand(action, JSON.stringify(actionArgs));
    },
    { action: actionName, actionArgs: args }
  );

  // Wait for scene to settle (entities spawned, materials applied)
  await page.waitForTimeout(2000);

  return result;
}

/**
 * Get the current scene state from the editor store.
 */
export async function getSceneState(): Promise<unknown> {
  if (!page) throw new Error('Browser not initialized. Call initBrowser() first.');

  return page.evaluate(() => {
    const store = (window as unknown as { __editorStore?: { getState: () => unknown } })
      .__editorStore;
    if (!store) return null;

    const state = store.getState() as Record<string, unknown>;
    return {
      sceneGraph: state.sceneGraph,
      sceneName: state.sceneName,
      engineMode: state.engineMode,
      physicsEnabled: state.physicsEnabled,
      allScripts: state.allScripts ? Object.keys(state.allScripts as object) : [],
    };
  });
}

/**
 * Take screenshots from multiple camera angles.
 * Returns array of file paths to saved screenshots.
 */
export async function takeScreenshots(
  experimentId: string,
  promptId: string
): Promise<string[]> {
  if (!page) throw new Error('Browser not initialized. Call initBrowser() first.');

  const screenshotDir = resolve(config.resultsDir, 'screenshots', experimentId);
  if (!existsSync(screenshotDir)) mkdirSync(screenshotDir, { recursive: true });

  const angles = [
    { name: 'perspective', yaw: 0.5, pitch: 0.4, radius: 15 },
    { name: 'topdown', yaw: 0, pitch: 1.4, radius: 20 },
    { name: 'closeup', yaw: 0.8, pitch: 0.3, radius: 8 },
  ];

  const paths: string[] = [];

  for (const angle of angles) {
    // Set camera via engine command
    await page.evaluate(
      ({ y, p, r }) => {
        const store = (window as unknown as { __editorStore?: { getState: () => unknown } })
          .__editorStore;
        if (!store) return;
        const state = store.getState() as {
          dispatchCommand?: (cmd: string, args: string) => Promise<unknown>;
        };
        if (state.dispatchCommand) {
          void state.dispatchCommand(
            'set_camera',
            JSON.stringify({ yaw: y, pitch: p, radius: r })
          );
        }
      },
      { y: angle.yaw, p: angle.pitch, r: angle.radius }
    );

    await page.waitForTimeout(500); // let camera settle

    // Screenshot the canvas area
    const canvas = page.locator('canvas').first();
    const filePath = resolve(screenshotDir, `${promptId}-${angle.name}.png`);
    await canvas.screenshot({ path: filePath });
    paths.push(filePath);
  }

  return paths;
}

/**
 * Reset the scene to a clean state for the next evaluation.
 */
export async function resetScene(): Promise<void> {
  if (!page) throw new Error('Browser not initialized. Call initBrowser() first.');

  await page.evaluate(() => {
    const store = (window as unknown as { __editorStore?: { getState: () => unknown } })
      .__editorStore;
    if (!store) return;
    const state = store.getState() as {
      dispatchCommand?: (cmd: string, args: string) => Promise<unknown>;
    };
    if (state.dispatchCommand) {
      void state.dispatchCommand('new_scene', JSON.stringify({}));
    }
  });

  await page.waitForTimeout(1000);
}

/**
 * Clean up browser resources.
 */
export async function closeBrowser(): Promise<void> {
  if (browser) {
    await browser.close();
    browser = null;
    page = null;
  }
}
