/**
 * Tutorial flow definitions for guided onboarding.
 * Each tutorial consists of steps that guide the user through core workflows.
 */

export interface TutorialStep {
  id: string;
  title: string;
  description: string;
  /** CSS selector of element to highlight (empty for intro slides) */
  target?: string;
  /** Position of instruction bubble relative to target */
  targetPosition?: 'top' | 'bottom' | 'left' | 'right';
  /** Action required from user before proceeding */
  actionRequired?: {
    type: 'click' | 'select-entity' | 'transform-change' | 'material-change' | 'entity-created' | 'play-mode' | 'edit-mode' | 'script-edit';
    value?: string; // Expected value (e.g., entity type)
  };
  /** Auto-advance to next step after action completes */
  autoAdvance?: boolean;
  /** Delay in ms before showing step (for animations) */
  delay?: number;
}

export interface TutorialFlow {
  id: string;
  name: string;
  description: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  estimatedMinutes: number;
  persona: 'beginner' | 'hobbyist' | 'developer' | 'ai-first';
  steps: TutorialStep[];
  tags: string[];
}

// Tutorial 1: Your First Scene
export const TUTORIAL_FIRST_SCENE: TutorialFlow = {
  id: 'first-scene',
  name: 'Your First Scene',
  description: 'Learn the basics of creating a 3D scene with entities and lighting',
  difficulty: 'beginner',
  estimatedMinutes: 3,
  persona: 'beginner',
  tags: ['3D', 'Basics', 'Essential'],
  steps: [
    {
      id: 'welcome',
      title: 'Welcome to Project Forge',
      description: "Let's build your first 3D scene together. You'll create a colorful cube and add lighting. Click Next to begin.",
    },
    {
      id: 'add-cube',
      title: 'Add a Cube',
      description: 'Right-click in the canvas area and select "Add Entity > Cube" from the context menu.',
      target: '.canvas-area',
      targetPosition: 'top',
      actionRequired: {
        type: 'entity-created',
        value: 'cube',
      },
      autoAdvance: true,
    },
    {
      id: 'move-cube',
      title: 'Transform Your Entity',
      description: 'See the colored arrows? That\'s the transform gizmo. Try dragging the blue arrow (Z-axis) to move the cube up.',
      target: '.canvas-area',
      targetPosition: 'top',
      actionRequired: {
        type: 'transform-change',
      },
      autoAdvance: true,
    },
    {
      id: 'change-color',
      title: 'Add Some Color',
      description: 'In the Inspector panel, find the Material section and click the Base Color swatch to choose a color.',
      target: '[data-testid="base-color-picker"]',
      targetPosition: 'left',
      actionRequired: {
        type: 'material-change',
      },
      autoAdvance: true,
    },
    {
      id: 'add-light',
      title: 'Let There Be Light',
      description: 'Right-click in the canvas again and add a Directional Light to illuminate your scene.',
      target: '.canvas-area',
      targetPosition: 'top',
      actionRequired: {
        type: 'entity-created',
        value: 'directional_light',
      },
      autoAdvance: true,
    },
    {
      id: 'press-play',
      title: 'See Your Creation',
      description: 'Click the Play button to enter Play Mode and see your scene in action.',
      target: '[aria-label="Play"]',
      targetPosition: 'bottom',
      actionRequired: {
        type: 'play-mode',
      },
      autoAdvance: true,
      delay: 1000,
    },
    {
      id: 'congratulations',
      title: 'You Did It!',
      description: "Congratulations! You've created your first 3D scene. Press Stop to return to Edit Mode, or continue to the next tutorial to learn about scripting.",
    },
  ],
};

// Tutorial 2: Make It Move
export const TUTORIAL_MAKE_IT_MOVE: TutorialFlow = {
  id: 'make-it-move',
  name: 'Make It Move',
  description: 'Add scripted behavior to make your entities come alive',
  difficulty: 'beginner',
  estimatedMinutes: 4,
  persona: 'beginner',
  tags: ['Scripting', 'Basics'],
  steps: [
    {
      id: 'welcome',
      title: 'Let\'s Add Movement',
      description: 'Now let\'s make things move! We\'ll add a script to make your cube rotate.',
    },
    {
      id: 'select-cube',
      title: 'Select Your Cube',
      description: 'Click on the cube in your scene to select it.',
      target: '.canvas-area',
      targetPosition: 'top',
      actionRequired: {
        type: 'select-entity',
      },
      autoAdvance: true,
    },
    {
      id: 'open-script-tab',
      title: 'Open Script Editor',
      description: 'Look for the "Script" button in the Inspector panel and click it.',
      target: '[data-tab="script"]',
      targetPosition: 'left',
      actionRequired: {
        type: 'click',
      },
      autoAdvance: true,
    },
    {
      id: 'choose-template',
      title: 'Use a Script Template',
      description: 'Click "Use Template" and select "Rotating Object" from the list.',
      target: '[data-testid="script-template-button"]',
      targetPosition: 'left',
      actionRequired: {
        type: 'script-edit',
      },
      autoAdvance: true,
    },
    {
      id: 'press-play',
      title: 'Watch It Spin',
      description: 'Click Play to see your cube rotate!',
      target: '[aria-label="Play"]',
      targetPosition: 'bottom',
      actionRequired: {
        type: 'play-mode',
      },
      autoAdvance: true,
      delay: 1000,
    },
    {
      id: 'congratulations',
      title: 'Great Work!',
      description: "You've learned how to add behavior to your entities using scripts. Press Stop to return to Edit Mode.",
    },
  ],
};

// Tutorial 3: Build with AI
export const TUTORIAL_AI_CHAT: TutorialFlow = {
  id: 'ai-chat',
  name: 'Build with AI',
  description: 'Use AI chat to build scenes and add interactivity in seconds',
  difficulty: 'beginner',
  estimatedMinutes: 5,
  persona: 'ai-first',
  tags: ['AI', 'Chat', 'Essential'],
  steps: [
    {
      id: 'welcome',
      title: 'AI-Powered Building',
      description: 'Let\'s use AI to build a scene in seconds. You\'ll see how powerful natural language can be!',
    },
    {
      id: 'open-chat',
      title: 'Open AI Chat',
      description: 'Press Ctrl+K (or Cmd+K on Mac) to open the AI Chat overlay.',
      actionRequired: {
        type: 'click',
      },
      autoAdvance: true,
    },
    {
      id: 'first-prompt',
      title: 'Your First AI Command',
      description: 'Type this message: "Create a scene with a red sphere on a green plane" and press Enter.',
      actionRequired: {
        type: 'click',
      },
      delay: 3000,
    },
    {
      id: 'add-physics',
      title: 'Add Interactivity',
      description: 'Now type: "Make the sphere bounce"',
      actionRequired: {
        type: 'click',
      },
      delay: 2000,
    },
    {
      id: 'press-play',
      title: 'See It In Action',
      description: 'Click Play to see the bouncing sphere!',
      target: '[aria-label="Play"]',
      targetPosition: 'bottom',
      actionRequired: {
        type: 'play-mode',
      },
      autoAdvance: true,
      delay: 1000,
    },
    {
      id: 'congratulations',
      title: 'Explore Further',
      description: 'Try asking the AI to add more objects, change colors, or add sound effects!',
    },
  ],
};

// Tutorial 4: Physics Playground
export const TUTORIAL_PHYSICS: TutorialFlow = {
  id: 'physics-playground',
  name: 'Physics Playground',
  description: 'Create a physics simulation with gravity and collisions',
  difficulty: 'intermediate',
  estimatedMinutes: 5,
  persona: 'hobbyist',
  tags: ['Physics', '3D'],
  steps: [
    {
      id: 'welcome',
      title: 'Build a Physics Scene',
      description: 'Let\'s build a physics playground! You\'ll create a ramp and watch a sphere roll down.',
    },
    {
      id: 'add-plane',
      title: 'Create a Ground',
      description: 'Right-click in the canvas and add a Plane entity.',
      target: '.canvas-area',
      targetPosition: 'top',
      actionRequired: {
        type: 'entity-created',
        value: 'plane',
      },
      autoAdvance: true,
    },
    {
      id: 'add-sphere',
      title: 'Add a Ball',
      description: 'Add a Sphere entity above the plane.',
      target: '.canvas-area',
      targetPosition: 'top',
      actionRequired: {
        type: 'entity-created',
        value: 'sphere',
      },
      autoAdvance: true,
    },
    {
      id: 'enable-physics',
      title: 'Enable Physics',
      description: 'Select the sphere, open the Physics tab in the Inspector, and check "Enable Physics". Set Type to "Dynamic".',
      target: '[data-tab="physics"]',
      targetPosition: 'left',
      actionRequired: {
        type: 'click',
      },
      autoAdvance: true,
    },
    {
      id: 'press-play',
      title: 'Watch Gravity',
      description: 'Click Play to watch the sphere fall!',
      target: '[aria-label="Play"]',
      targetPosition: 'bottom',
      actionRequired: {
        type: 'play-mode',
      },
      autoAdvance: true,
      delay: 1000,
    },
    {
      id: 'congratulations',
      title: 'Experiment',
      description: 'Try changing Mass and Friction in the Physics panel to see different behaviors.',
    },
  ],
};

// Tutorial registry
export const TUTORIALS: TutorialFlow[] = [
  TUTORIAL_FIRST_SCENE,
  TUTORIAL_MAKE_IT_MOVE,
  TUTORIAL_AI_CHAT,
  TUTORIAL_PHYSICS,
];
