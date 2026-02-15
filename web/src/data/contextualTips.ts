export interface ContextualTip {
  id: string;
  title: string;
  message: string;
  trigger: 'first-time' | 'condition';
  condition?: string;
  actionLabel?: string;
  actionRoute?: string;
}

export const CONTEXTUAL_TIPS: ContextualTip[] = [
  {
    id: 'empty-scene',
    title: 'Getting Started',
    message: 'Your scene is empty! Try adding an entity using the + button in the toolbar, or ask the AI to create something for you.',
    trigger: 'first-time',
  },
  {
    id: 'no-lighting',
    title: 'Scene is Dark?',
    message: 'Your scene might need lighting. Add a directional light to illuminate objects.',
    trigger: 'condition',
    condition: 'No light entities in scene',
  },
  {
    id: 'no-camera-play',
    title: 'Set Up a Camera',
    message: 'Add a Game Camera to your player entity so the camera follows them in Play mode.',
    trigger: 'condition',
    condition: 'Entering play mode without game camera',
  },
  {
    id: 'physics-no-ground',
    title: 'Objects Falling?',
    message: 'Add a plane with a Fixed physics body to act as the ground.',
    trigger: 'condition',
    condition: 'Physics enabled but no fixed body',
  },
  {
    id: 'script-error',
    title: 'Script Issue',
    message: 'Check the browser console for script errors. Common issues: typos in API names, missing forge.onUpdate wrapper.',
    trigger: 'condition',
    condition: 'Script execution error',
  },
  {
    id: 'first-play',
    title: 'Play Mode',
    message: 'Press the Stop button to return to Edit mode. Changes in Play mode are temporary!',
    trigger: 'first-time',
  },
  {
    id: 'save-reminder',
    title: 'Save Your Work',
    message: 'Use Ctrl+S to save your project. Your work is stored in the browser.',
    trigger: 'condition',
    condition: '5 minutes without saving',
  },
  {
    id: 'ai-tip',
    title: 'Try the AI',
    message: 'The AI chat can help you build scenes faster. Try: "Create a forest scene with trees and lighting"',
    trigger: 'first-time',
  },
  {
    id: 'prefab-tip',
    title: 'Use Prefabs',
    message: 'Right-click an entity to save it as a prefab. Prefabs let you reuse configurations across your project.',
    trigger: 'condition',
    condition: 'Created 3+ similar entities',
  },
  {
    id: 'export-ready',
    title: 'Ready to Share?',
    message: 'Your game looks great! Click the Export button to download it, or Publish to share it online.',
    trigger: 'condition',
    condition: 'Scene has 5+ entities and scripts',
  },
];
