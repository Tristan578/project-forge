import type { EntityType, GameComponentData, InputBinding, Physics2dData, ProjectType } from '@/stores/slices/types';

export interface ReplayFixture {
  fixtureId: string;
  description: string;
  projectType: ProjectType;
  inputBindings: InputBinding[];
  entities: Array<{
    id: string;
    name: string;
    entityType: EntityType;
    position: [number, number, number];
    scale: [number, number, number];
    physics2d: Physics2dData;
    gameComponents: GameComponentData[];
  }>;
  winCondition: { conditionType: string };
  replay: { actionNames: string[]; holdActions: string[]; ticks: number };
}

const fixture = {
  "fixtureId": "minimal-2d-replay",
  "description": "Minimal 2D scene for #9902 record/replay: one player with a character controller and a rightward move binding, and one collectible on the player's path. Applied through real engine commands by e2e/engine/inputReplay.spec.ts.",
  "projectType": "2d",
  "inputBindings": [
    {
      "actionName": "move_right",
      "actionType": "axis",
      "sources": [],
      "positiveKeys": ["KeyD", "ArrowRight"],
      "negativeKeys": ["KeyA", "ArrowLeft"],
      "deadZone": 0.1
    }
  ],
  "entities": [
    {
      "id": "player",
      "name": "Player",
      "entityType": "cube",
      "position": [0, 0, 0],
      "scale": [1, 1, 1],
      "physics2d": {
        "bodyType": "kinematic", "colliderShape": "box", "size": [1, 1],
        "radius": 0.5, "vertices": [], "mass": 1, "friction": 0,
        "restitution": 0, "gravityScale": 0, "isSensor": false,
        "lockRotation": true, "continuousDetection": true,
        "oneWayPlatform": false, "surfaceVelocity": [0, 0]
      },
      "gameComponents": [
        {
          "type": "characterController",
          "characterController": {
            "speed": 5,
            "jumpHeight": 0,
            "gravityScale": 0,
            "canDoubleJump": false
          }
        }
      ]
    },
    {
      "id": "coin",
      "name": "Coin",
      "entityType": "cube",
      "position": [1.5, 0, 0],
      "scale": [1.5, 1.5, 1],
      "physics2d": {
        "bodyType": "static", "colliderShape": "box", "size": [1, 1],
        "radius": 0.5, "vertices": [], "mass": 1, "friction": 0,
        "restitution": 0, "gravityScale": 0, "isSensor": true,
        "lockRotation": true, "continuousDetection": false,
        "oneWayPlatform": false, "surfaceVelocity": [0, 0]
      },
      "gameComponents": [
        {
          "type": "collectible",
          "collectible": {
            "value": 1,
            "destroyOnCollect": true,
            "pickupSoundAsset": null,
            "rotateSpeed": 0
          }
        }
      ]
    }
  ],
  "winCondition": {
    "conditionType": "collectAll"
  },
  "replay": {
    "actionNames": ["move_right"],
    "holdActions": ["move_right"],
    "ticks": 120
  }
} satisfies ReplayFixture;

export default fixture;
