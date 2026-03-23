/**
 * Panel registry for the dockview workspace system.
 * Maps panel IDs to metadata used by WorkspaceProvider and preset layouts.
 */

/** AI panel categories used to group panels in the AI Studio sidebar. */
export type AIPanelCategory = 'creation' | 'polish' | 'intelligence' | 'tools';

export interface PanelDefinition {
  id: string;
  title: string;
  /** Key into the `components` prop of DockviewReact */
  component: string;
  /** Default minimum width in pixels */
  minWidth?: number;
  /** Default minimum height in pixels */
  minHeight?: number;
  /** If true, panel cannot be closed by the user */
  unclosable?: boolean;
  /** Renderer strategy: 'always' keeps DOM alive when hidden (for canvas/editors) */
  renderer?: 'onlyWhenVisible' | 'always';
  /**
   * AI Studio category.
   *
   * - `creation`     — generative tools that produce new content (GDD, levels, narrative, rigs)
   * - `polish`       — tools that improve existing content (art style, effects, accessibility)
   * - `intelligence` — analytical tools that evaluate or adapt gameplay (review, analytics, DDA)
   * - `tools`        — utility/design tools (idea generation, economy, world building)
   *
   * Omitted for non-AI panels (viewport, hierarchy, inspector, etc.).
   */
  category?: AIPanelCategory;
}

export const PANEL_DEFINITIONS: Record<string, PanelDefinition> = {
  'scene-viewport': {
    id: 'scene-viewport',
    title: 'Scene',
    component: 'scene-viewport',
    minWidth: 400,
    minHeight: 300,
    unclosable: true,
    renderer: 'always',
  },
  'script-editor': {
    id: 'script-editor',
    title: 'Script Editor',
    component: 'script-editor',
    minWidth: 300,
    minHeight: 200,
  },
  'scene-hierarchy': {
    id: 'scene-hierarchy',
    title: 'Hierarchy',
    component: 'scene-hierarchy',
    minWidth: 160,
    minHeight: 100,
  },
  'script-explorer': {
    id: 'script-explorer',
    title: 'Scripts',
    component: 'script-explorer',
    minWidth: 160,
    minHeight: 100,
  },
  inspector: {
    id: 'inspector',
    title: 'Inspector',
    component: 'inspector',
    minWidth: 220,
    minHeight: 100,
  },
  'scene-settings': {
    id: 'scene-settings',
    title: 'Scene Settings',
    component: 'scene-settings',
    minWidth: 220,
    minHeight: 100,
  },
  'ui-builder': {
    id: 'ui-builder',
    title: 'UI Builder',
    component: 'ui-builder',
    minWidth: 220,
    minHeight: 100,
  },
  'asset-browser': {
    id: 'asset-browser',
    title: 'Assets',
    component: 'asset-browser',
    minWidth: 200,
    minHeight: 80,
  },
  'audio-mixer': {
    id: 'audio-mixer',
    title: 'Audio Mixer',
    component: 'audio-mixer',
    minWidth: 200,
    minHeight: 80,
  },
  docs: {
    id: 'docs',
    title: 'Documentation',
    component: 'docs',
    minWidth: 280,
    minHeight: 200,
  },
  'dialogue-editor': {
    id: 'dialogue-editor',
    title: 'Dialogue Editor',
    component: 'dialogue-editor',
    minWidth: 280,
    minHeight: 200,
  },
  tileset: {
    id: 'tileset',
    title: 'Tileset',
    component: 'tileset',
    minWidth: 200,
    minHeight: 150,
  },
  timeline: {
    id: 'timeline',
    title: 'Timeline',
    component: 'timeline',
    minWidth: 400,
    minHeight: 150,
    renderer: 'always',
  },
  taskboard: {
    id: 'taskboard',
    title: 'Tasks',
    component: 'taskboard',
    minWidth: 200,
    minHeight: 150,
  },
  // ---- AI: creation --------------------------------------------------------
  'procedural-anim': {
    id: 'procedural-anim',
    title: 'Procedural Animation',
    component: 'procedural-anim',
    minWidth: 220,
    minHeight: 200,
    category: 'creation',
  },
  'behavior-tree': {
    id: 'behavior-tree',
    title: 'Behavior Tree',
    component: 'behavior-tree',
    minWidth: 260,
    minHeight: 200,
    category: 'creation',
  },
  'level-generator': {
    id: 'level-generator',
    title: 'Level Generator',
    component: 'level-generator',
    minWidth: 260,
    minHeight: 200,
    category: 'creation',
  },
  narrative: {
    id: 'narrative',
    title: 'Narrative Arc',
    component: 'narrative',
    minWidth: 260,
    minHeight: 200,
    category: 'creation',
  },
  'auto-rigging': {
    id: 'auto-rigging',
    title: 'Auto-Rigging',
    component: 'auto-rigging',
    minWidth: 260,
    minHeight: 200,
    category: 'creation',
  },
  // ---- AI: polish ----------------------------------------------------------
  'art-style': {
    id: 'art-style',
    title: 'Art Style',
    component: 'art-style',
    minWidth: 260,
    minHeight: 200,
    category: 'polish',
  },
  'effect-bindings': {
    id: 'effect-bindings',
    title: 'Effects',
    component: 'effect-bindings',
    minWidth: 220,
    minHeight: 150,
    category: 'polish',
  },
  tutorial: {
    id: 'tutorial',
    title: 'Tutorial Generator',
    component: 'tutorial',
    minWidth: 240,
    minHeight: 200,
    category: 'polish',
  },
  accessibility: {
    id: 'accessibility',
    title: 'Accessibility',
    component: 'accessibility',
    minWidth: 260,
    minHeight: 200,
    category: 'polish',
  },
  'save-system': {
    id: 'save-system',
    title: 'Save System',
    component: 'save-system',
    minWidth: 260,
    minHeight: 200,
    category: 'polish',
  },
  'texture-painter': {
    id: 'texture-painter',
    title: 'Texture Painter',
    component: 'texture-painter',
    minWidth: 260,
    minHeight: 200,
    category: 'polish',
  },
  // ---- AI: intelligence ----------------------------------------------------
  review: {
    id: 'review',
    title: 'AI Review',
    component: 'review',
    minWidth: 220,
    minHeight: 200,
    category: 'intelligence',
  },
  'auto-iteration': {
    id: 'auto-iteration',
    title: 'Auto-Iteration',
    component: 'auto-iteration',
    minWidth: 260,
    minHeight: 200,
    category: 'intelligence',
  },
  'game-analytics': {
    id: 'game-analytics',
    title: 'Game Analytics',
    component: 'game-analytics',
    minWidth: 280,
    minHeight: 200,
    category: 'intelligence',
  },
  playtest: {
    id: 'playtest',
    title: 'Playtest Bot',
    component: 'playtest',
    minWidth: 260,
    minHeight: 200,
    category: 'intelligence',
  },
  difficulty: {
    id: 'difficulty',
    title: 'Dynamic Difficulty',
    component: 'difficulty',
    minWidth: 260,
    minHeight: 200,
    category: 'intelligence',
  },
  'pacing-analyzer': {
    id: 'pacing-analyzer',
    title: 'Pacing Analyzer',
    component: 'pacing-analyzer',
    minWidth: 280,
    minHeight: 200,
    category: 'intelligence',
  },
  'physics-feel': {
    id: 'physics-feel',
    title: 'Physics Feel',
    component: 'physics-feel',
    minWidth: 260,
    minHeight: 200,
    category: 'intelligence',
  },
  // ---- AI: tools -----------------------------------------------------------
  'idea-generator': {
    id: 'idea-generator',
    title: 'Idea Generator',
    component: 'idea-generator',
    minWidth: 260,
    minHeight: 200,
    category: 'tools',
  },
  'smart-camera': {
    id: 'smart-camera',
    title: 'Smart Camera',
    component: 'smart-camera',
    minWidth: 260,
    minHeight: 200,
    category: 'tools',
  },
  'design-teacher': {
    id: 'design-teacher',
    title: 'Design Teacher',
    component: 'design-teacher',
    minWidth: 280,
    minHeight: 200,
    category: 'tools',
  },
  'world-builder': {
    id: 'world-builder',
    title: 'World Builder',
    component: 'world-builder',
    minWidth: 280,
    minHeight: 200,
    category: 'tools',
  },
  economy: {
    id: 'economy',
    title: 'Economy Designer',
    component: 'economy',
    minWidth: 260,
    minHeight: 200,
    category: 'tools',
  },
  'quest-generator': {
    id: 'quest-generator',
    title: 'Quest Generator',
    component: 'quest-generator',
    minWidth: 260,
    minHeight: 200,
    category: 'tools',
  },
  'gdd-generator': {
    id: 'gdd-generator',
    title: 'GDD Generator',
    component: 'gdd-generator',
    minWidth: 280,
    minHeight: 200,
  },
};

/** Panel IDs that should never be closed by the user. */
export const UNCLOSABLE_PANELS = new Set(
  Object.values(PANEL_DEFINITIONS)
    .filter((d) => d.unclosable)
    .map((d) => d.id)
);

/** All AI panel definitions, grouped by category. */
export const AI_PANELS_BY_CATEGORY: Record<AIPanelCategory, PanelDefinition[]> = {
  creation: Object.values(PANEL_DEFINITIONS).filter((d) => d.category === 'creation'),
  polish: Object.values(PANEL_DEFINITIONS).filter((d) => d.category === 'polish'),
  intelligence: Object.values(PANEL_DEFINITIONS).filter((d) => d.category === 'intelligence'),
  tools: Object.values(PANEL_DEFINITIONS).filter((d) => d.category === 'tools'),
};
