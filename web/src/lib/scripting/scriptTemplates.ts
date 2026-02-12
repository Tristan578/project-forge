export interface ScriptTemplate {
  id: string;
  name: string;
  description: string;
  source: string;
}

export const SCRIPT_TEMPLATES: ScriptTemplate[] = [
  {
    id: 'character_controller',
    name: 'Character Controller',
    description: 'WASD movement + jump using physics',
    source: `const speed = 5;
const jumpForce = 8;

function onUpdate(dt) {
  let dx = 0, dz = 0;
  if (forge.input.isPressed("move_forward")) dz -= speed * dt;
  if (forge.input.isPressed("move_backward")) dz += speed * dt;
  if (forge.input.isPressed("move_left")) dx -= speed * dt;
  if (forge.input.isPressed("move_right")) dx += speed * dt;

  forge.translate(entityId, dx, 0, dz);

  if (forge.input.justPressed("jump")) {
    forge.physics.applyImpulse(entityId, 0, jumpForce, 0);
  }
}`,
  },
  {
    id: 'collectible',
    name: 'Collectible',
    description: 'Slowly rotating pickup item',
    source: `function onUpdate(dt) {
  forge.rotate(entityId, 0, 90 * dt, 0);
}`,
  },
  {
    id: 'rotating_object',
    name: 'Rotating Object',
    description: 'Continuous Y-axis rotation',
    source: `const speed = 45; // degrees per second

function onUpdate(dt) {
  forge.rotate(entityId, 0, speed * dt, 0);
}`,
  },
  {
    id: 'follow_camera',
    name: 'Follow Camera',
    description: 'Smoothly follows a target entity',
    source: `const offset = { x: 0, y: 5, z: 8 };
const smoothing = 5;
let targetId = null;

function onStart() {
  targetId = forge.state.get("followTarget") || null;
}

function onUpdate(dt) {
  if (!targetId) return;
  const target = forge.getTransform(targetId);
  if (!target) return;

  const goalX = target.position[0] + offset.x;
  const goalY = target.position[1] + offset.y;
  const goalZ = target.position[2] + offset.z;

  const cam = forge.getTransform(entityId);
  if (!cam) return;
  const t = Math.min(1, smoothing * dt);

  forge.setPosition(entityId,
    cam.position[0] + (goalX - cam.position[0]) * t,
    cam.position[1] + (goalY - cam.position[1]) * t,
    cam.position[2] + (goalZ - cam.position[2]) * t
  );
}`,
  },
];
