/**
 * Arena Shooter Game Template
 *
 * First-person arena shooter with targets, scoring system, and ammo management.
 */

import type { GameTemplate } from './index';

export const SHOOTER_TEMPLATE: GameTemplate = {
  id: 'shooter',
  name: 'Arena Shooter',
  description: 'First-person shooting gallery. Hit targets, rack up points.',
  category: 'shooter',
  difficulty: 'intermediate',
  thumbnail: {
    gradient: 'linear-gradient(135deg, #ef4444, #b91c1c)',
    icon: 'Crosshair',
    accentColor: '#ef4444',
  },
  tags: ['3d', 'fps', 'shooter', 'projectile'],

  inputPreset: 'fps',

  sceneData: {
    formatVersion: 3,
    metadata: {
      name: 'Arena Shooter',
      createdAt: new Date().toISOString(),
      modifiedAt: new Date().toISOString(),
    },
    environment: {
      skyboxBrightness: 0.8,
      iblIntensity: 1.0,
      iblRotationDegrees: 0,
      clearColor: [0.1, 0.1, 0.15],
      fogEnabled: true,
      fogColor: [0.1, 0.1, 0.15],
      fogStart: 20,
      fogEnd: 60,
      skyboxPreset: 'night',
      skyboxAssetId: null,
    },
    ambientLight: {
      color: [1, 1, 1],
      brightness: 250,
    },
    inputBindings: {},
    postProcessing: {
      bloomEnabled: true,
      bloomIntensity: 0.2,
      bloomThreshold: 1.0,
      chromaticAberrationEnabled: false,
      chromaticAberrationIntensity: 0.0,
      colorGradingEnabled: true,
      colorGradingExposure: -0.1,
      colorGradingContrast: 1.1,
      colorGradingSaturation: 0.9,
      sharpeningEnabled: false,
      sharpeningIntensity: 0.0,
    },
    entities: [
      // Player
      {
        entityId: 'player',
        entityName: 'Player',
        entityType: 'Capsule',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, 1, 8],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [0.7, 1, 0.7],
        },
        material: {
          baseColor: [0.2, 0.3, 0.6, 1.0],
          metallic: 0.6,
          perceptualRoughness: 0.4,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'dynamic',
            colliderShape: 'capsule',
            restitution: 0.0,
            friction: 0.5,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: true,
            lockRotationY: true,
            lockRotationZ: true,
            isSensor: false,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'characterController',
            speed: 5,
            jumpHeight: 6,
            canDoubleJump: false,
            gravityScale: 1.0,
          },
          {
            type: 'health',
            maxHp: 100,
            currentHp: 100,
            respawnOnDeath: false,
          },
        ],
      },
      // Arena Floor
      {
        entityId: 'arena_floor',
        entityName: 'Arena_Floor',
        entityType: 'Plane',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, 0, 0],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [15, 1, 15],
        },
        material: {
          baseColor: [0.4, 0.4, 0.4, 1.0],
          metallic: 0.1,
          perceptualRoughness: 0.85,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.8,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
      },
      // Walls (North, South, East, West)
      ...([[0, 2, -15, 30, 4, 0.5], [0, 2, 15, 30, 4, 0.5], [15, 2, 0, 0.5, 4, 30], [-15, 2, 0, 0.5, 4, 30]] as number[][]).map((params, i) => ({
        entityId: `wall_${['n', 's', 'e', 'w'][i]}`,
        entityName: `Wall_${['N', 'S', 'E', 'W'][i]}`,
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [params[0], params[1], params[2]] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [params[3], params[4], params[5]] as [number, number, number],
        },
        material: {
          baseColor: [0.25, 0.25, 0.25, 1.0],
          metallic: 0.1,
          perceptualRoughness: 0.8,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.5,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
      })),
      // Cover objects
      ...([[5, 1, -3, 2, 2, 1], [-4, 1, 4, 1.5, 2, 1.5], [0, 1, -8, 3, 2, 0.8]] as number[][]).map((params, i) => ({
        entityId: `cover_${i + 1}`,
        entityName: `Cover_${i + 1}`,
        entityType: 'Cube',
        parentId: null,
        visible: true,
        transform: {
          translation: [params[0], params[1], params[2]] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [params[3], params[4], params[5]] as [number, number, number],
        },
        material: {
          baseColor: [0.5, 0.35, 0.2, 1.0],
          metallic: 0.0,
          perceptualRoughness: 0.7,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'fixed',
            colliderShape: 'cuboid',
            restitution: 0.0,
            friction: 0.5,
            density: 1.0,
            gravityScale: 1.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
      })),
      // Targets 1-6
      ...Array.from({ length: 6 }, (_, i) => ({
        entityId: `target_${String(i + 1).padStart(2, '0')}`,
        entityName: `Target_${String(i + 1).padStart(2, '0')}`,
        entityType: 'Sphere',
        parentId: null,
        visible: true,
        transform: {
          translation: [
            [6, -7, 4, -5, 8, -6][i],
            1.5,
            [-5, -3, -6, 2, -8, -10][i]
          ] as [number, number, number],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [0.8, 0.8, 0.8] as [number, number, number],
        },
        material: {
          baseColor: [1.0, 0.2, 0.2, 1.0],
          metallic: 0.3,
          perceptualRoughness: 0.4,
          reflectance: 0.5,
          emissive: [0.6, 0.1, 0.1, 1.0],
          emissiveExposureWeight: 1,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        physics: {
          data: {
            bodyType: 'dynamic',
            colliderShape: 'ball',
            restitution: 0.0,
            friction: 0.0,
            density: 1.0,
            gravityScale: 0.0,
            lockTranslationX: false,
            lockTranslationY: false,
            lockTranslationZ: false,
            lockRotationX: false,
            lockRotationY: false,
            lockRotationZ: false,
            isSensor: false,
          },
          enabled: true,
        },
        gameComponents: [
          {
            type: 'health',
            maxHp: 10,
            currentHp: 10,
            respawnOnDeath: true,
          },
        ],
      })),
      // Game Manager
      {
        entityId: 'game_manager',
        entityName: 'GameManager',
        entityType: 'Cube',
        parentId: null,
        visible: false,
        transform: {
          translation: [0, -10, 0],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [0.1, 0.1, 0.1],
        },
        material: {
          baseColor: [1, 1, 1, 1],
          metallic: 0,
          perceptualRoughness: 0.5,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
        gameComponents: [
          {
            type: 'winCondition',
            conditionType: 'score',
            targetScore: 100,
          },
        ],
      },
      // Crosshair entity
      {
        entityId: 'crosshair',
        entityName: 'Crosshair',
        entityType: 'Cube',
        parentId: null,
        visible: false,
        transform: {
          translation: [0, -10, 2],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [0.1, 0.1, 0.1],
        },
        material: {
          baseColor: [1, 1, 1, 1],
          metallic: 0,
          perceptualRoughness: 0.5,
          reflectance: 0.5,
          emissive: [0, 0, 0, 0],
          emissiveExposureWeight: 0,
          alphaMode: 'opaque',
          alphaCutoff: 0.5,
          doubleSided: false,
          unlit: false,
        },
      },
      // Sun
      {
        entityId: 'sun',
        entityName: 'Sun',
        entityType: 'DirectionalLight',
        parentId: null,
        visible: true,
        transform: {
          translation: [5, 20, 5],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [1, 1, 1],
        },
        light: {
          lightType: 'directional',
          color: [1.0, 0.95, 0.9],
          intensity: 4000,
          shadowsEnabled: true,
          shadowDepthBias: 0.02,
          shadowNormalBias: 1.8,
          range: 0,
          radius: 0,
          innerAngle: 0,
          outerAngle: 0,
        },
      },
      // Spot Light
      {
        entityId: 'spot_light',
        entityName: 'SpotLight_1',
        entityType: 'SpotLight',
        parentId: null,
        visible: true,
        transform: {
          translation: [0, 8, 0],
          rotation: [0, 0, 0, 1] as [number, number, number, number],
          scale: [1, 1, 1],
        },
        light: {
          lightType: 'spot',
          color: [1.0, 1.0, 1.0],
          intensity: 3000,
          shadowsEnabled: false,
          shadowDepthBias: 0.02,
          shadowNormalBias: 1.8,
          range: 20,
          radius: 0,
          innerAngle: 0.5,
          outerAngle: 0.8,
        },
      },
    ],
  },

  scripts: {
    player: {
      source: `// FPS Controller -- WASD movement, shooting
const SPEED = 5;
const SHOOT_COOLDOWN = 0.3;
let cooldown = 0;
let ammo = 30;
const maxAmmo = 30;

function onStart() {
  forge.state.set("ammo", ammo);
  forge.state.set("maxAmmo", maxAmmo);
}

function onUpdate(dt) {
  // Movement
  let dx = 0, dz = 0;
  if (forge.input.isPressed("move_forward")) dz -= SPEED * dt;
  if (forge.input.isPressed("move_backward")) dz += SPEED * dt;
  if (forge.input.isPressed("move_left")) dx -= SPEED * dt;
  if (forge.input.isPressed("move_right")) dx += SPEED * dt;
  forge.translate(entityId, dx, 0, dz);

  // Jump
  if (forge.input.justPressed("jump")) {
    forge.physics.applyImpulse(entityId, 0, 6, 0);
  }

  // Shooting
  cooldown -= dt;
  if (forge.input.justPressed("fire") && cooldown <= 0 && ammo > 0) {
    const pos = forge.getTransform(entityId)?.position;
    if (pos) {
      // Spawn projectile forward (negative Z)
      const projId = forge.spawn("sphere", {
        name: "Bullet",
        position: [pos[0], pos[1] + 0.5, pos[2] - 1]
      });
      forge.setScale(projId, 0.15, 0.15, 0.15);
      forge.setColor(projId, 1, 1, 0);
      forge.setEmissive(projId, 1, 0.8, 0, 3);
      // Apply forward velocity via state for bullet script
      forge.state.set("bullet_" + projId, { dir: [0, 0, -1], life: 2.0 });

      ammo--;
      forge.state.set("ammo", ammo);
      cooldown = SHOOT_COOLDOWN;
    }
  }
}`,
      enabled: true,
    },
    game_manager: {
      source: `// Arena Shooter Manager -- score tracking, HUD, win detection
let score = 0;
let gameTime = 0;
const WIN_SCORE = 100;

function onStart() {
  forge.ui.showText("score", "Score: 0", 5, 5, {
    fontSize: 22, color: "#ffdd00"
  });
  forge.ui.showText("ammo", "Ammo: 30 / 30", 5, 90, {
    fontSize: 18, color: "#88ff88"
  });
  forge.ui.showText("hp", "HP: 100", 80, 90, {
    fontSize: 18, color: "#ff4444"
  });
  forge.ui.showText("timer", "Time: 0:00", 80, 5, {
    fontSize: 18, color: "#aaaaaa"
  });
  forge.ui.showText("goal", "Target: " + WIN_SCORE + " points", 35, 95, {
    fontSize: 14, color: "#666666"
  });
}

function onUpdate(dt) {
  gameTime += dt;
  const mins = Math.floor(gameTime / 60);
  const secs = Math.floor(gameTime % 60);
  forge.ui.updateText("timer", "Time: " + mins + ":" + (secs < 10 ? "0" : "") + secs);

  // Read score from state (set by target scripts)
  const currentScore = forge.state.get("totalScore") || 0;
  if (currentScore !== score) {
    score = currentScore;
    forge.ui.updateText("score", "Score: " + score);

    if (score >= WIN_SCORE) {
      forge.ui.showText("win", "YOU WIN!", 35, 40, {
        fontSize: 48, color: "#ffd700"
      });
      forge.ui.showText("winTime", "Time: " + mins + ":" + (secs < 10 ? "0" : "") + secs, 38, 55, {
        fontSize: 20, color: "#ffffff"
      });
    }
  }

  // Update ammo display
  const ammo = forge.state.get("ammo") ?? 30;
  const maxAmmo = forge.state.get("maxAmmo") ?? 30;
  forge.ui.updateText("ammo", "Ammo: " + ammo + " / " + maxAmmo);
}`,
      enabled: true,
    },
    crosshair: {
      source: `// Crosshair HUD -- shows a + in the center of the screen
function onStart() {
  forge.ui.showText("crosshair", "+", 49, 48, {
    fontSize: 28, color: "#ffffff"
  });
}

function onUpdate(_dt) {}`,
      enabled: true,
    },
  },
};
