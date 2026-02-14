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
  {
    id: 'enemy_patrol',
    name: 'Enemy Patrol',
    description: 'Enemy that patrols between waypoints and chases the player when close',
    source: `// Enemy Patrol - patrols and chases player
const PATROL_SPEED = 2;
const CHASE_SPEED = 4;
const DETECT_RANGE = 8;
const PATROL_POINTS = [
  [0, 0.5, -5],
  [5, 0.5, 0],
  [0, 0.5, 5],
  [-5, 0.5, 0],
];
let currentPoint = 0;
let isChasing = false;

function onUpdate(dt) {
  const pos = forge.getTransform(entityId)?.position;
  if (!pos) return;

  // Find player by name
  const players = forge.scene.findByName("Player");
  if (players.length > 0) {
    const dist = forge.physics.distanceTo(entityId, players[0]);
    isChasing = dist < DETECT_RANGE;

    if (isChasing) {
      // Chase player
      const playerPos = forge.getTransform(players[0])?.position;
      if (playerPos) {
        const dx = playerPos[0] - pos[0];
        const dz = playerPos[2] - pos[2];
        const len = Math.sqrt(dx * dx + dz * dz);
        if (len > 0.5) {
          forge.translate(entityId, (dx / len) * CHASE_SPEED * dt, 0, (dz / len) * CHASE_SPEED * dt);
        }
      }
      forge.setColor(entityId, 1, 0, 0); // Red when chasing
      return;
    }
  }

  // Patrol
  forge.setColor(entityId, 0.5, 0.5, 1); // Blue when patrolling
  const target = PATROL_POINTS[currentPoint];
  const dx = target[0] - pos[0];
  const dz = target[2] - pos[2];
  const len = Math.sqrt(dx * dx + dz * dz);

  if (len < 0.5) {
    currentPoint = (currentPoint + 1) % PATROL_POINTS.length;
  } else {
    forge.translate(entityId, (dx / len) * PATROL_SPEED * dt, 0, (dz / len) * PATROL_SPEED * dt);
  }
}`,
  },
  {
    id: 'health_system',
    name: 'Health System',
    description: 'Tracks player health, displays HP bar, handles damage from contacts',
    source: `// Health System - HP tracking with damage on contact
let maxHP = 100;
let currentHP = 100;
let invulnerable = false;
let invulnTimer = 0;

function onStart() {
  forge.ui.showText("hp", "HP: 100 / 100", 5, 5, { fontSize: 20, color: "#00ff00" });
}

function onUpdate(dt) {
  // Invulnerability timer
  if (invulnerable) {
    invulnTimer -= dt;
    if (invulnTimer <= 0) invulnerable = false;
  }

  // Check for enemy contacts
  if (!invulnerable) {
    const contacts = forge.physics.getContacts(entityId, 1.5);
    for (const cid of contacts) {
      const name = forge.scene.getEntityName(cid) || "";
      if (name.toLowerCase().includes("enemy") || name.toLowerCase().includes("hazard")) {
        currentHP = Math.max(0, currentHP - 10);
        invulnerable = true;
        invulnTimer = 1.0; // 1 second invulnerability
        break;
      }
    }
  }

  // Update UI
  const pct = currentHP / maxHP;
  let color = "#00ff00";
  if (pct < 0.3) color = "#ff0000";
  else if (pct < 0.6) color = "#ffaa00";
  forge.ui.updateText("hp", "HP: " + currentHP + " / " + maxHP);

  if (currentHP <= 0) {
    forge.ui.showText("gameover", "GAME OVER", 50, 50, { fontSize: 48, color: "#ff0000" });
  }
}`,
  },
  {
    id: 'score_manager',
    name: 'Score Manager',
    description: 'Tracks and displays score, handles collectible pickup detection',
    source: `// Score Manager - pickup detection and score display
let score = 0;
let collected = new Set();

function onStart() {
  forge.ui.showText("score", "Score: 0", 85, 5, { fontSize: 22, color: "#ffdd00" });
  forge.ui.showText("info", "Collect the items!", 30, 90, { fontSize: 16, color: "#ffffff" });
}

function onUpdate(dt) {
  // Check for collectible contacts
  const nearby = forge.physics.getContacts(entityId, 2.0);
  for (const cid of nearby) {
    if (collected.has(cid)) continue;
    const name = forge.scene.getEntityName(cid) || "";
    if (name.toLowerCase().includes("coin") || name.toLowerCase().includes("collect") || name.toLowerCase().includes("pickup")) {
      score += 10;
      collected.add(cid);
      forge.setVisibility(cid, false);
      forge.ui.updateText("score", "Score: " + score);
    }
  }
}`,
  },
  {
    id: 'projectile',
    name: 'Projectile Shooter',
    description: 'Shoots projectiles on input, with lifetime and collision',
    source: `// Projectile Shooter - spawns and manages projectiles
const FIRE_RATE = 0.3; // seconds between shots
const PROJECTILE_SPEED = 15;
let cooldown = 0;
let projectiles = [];

function onUpdate(dt) {
  cooldown -= dt;

  // Fire on input
  if (forge.input.justPressed("fire") && cooldown <= 0) {
    const pos = forge.getTransform(entityId)?.position;
    if (pos) {
      const id = forge.spawn("sphere", { name: "Projectile", position: [pos[0], pos[1] + 0.5, pos[2] - 1] });
      projectiles.push({ id, life: 3.0, dir: [0, 0, -1] });
      cooldown = FIRE_RATE;
    }
  }

  // Update projectiles
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.life -= dt;
    if (p.life <= 0) {
      forge.destroy(p.id);
      projectiles.splice(i, 1);
      continue;
    }
    forge.translate(p.id, p.dir[0] * PROJECTILE_SPEED * dt, p.dir[1] * PROJECTILE_SPEED * dt, p.dir[2] * PROJECTILE_SPEED * dt);
  }
}`,
  },
  {
    id: 'npc_dialog',
    name: 'NPC Dialog',
    description: 'NPC that shows dialog when the player approaches',
    source: `// NPC Dialog - proximity-triggered conversation
const TALK_RANGE = 3;
const MESSAGES = [
  "Hello, traveler!",
  "The dungeon lies to the north.",
  "Be careful of the red enemies!",
  "Good luck on your quest!",
];
let messageIndex = 0;
let showingDialog = false;
let dialogTimer = 0;

function onUpdate(dt) {
  const players = forge.scene.findByName("Player");
  if (players.length === 0) return;

  const dist = forge.physics.distanceTo(entityId, players[0]);

  if (dist < TALK_RANGE && !showingDialog) {
    // Show interact prompt
    forge.ui.showText("npc_prompt", "Press E to talk", 40, 80, { fontSize: 16, color: "#aaaaff" });
    forge.setEmissive(entityId, 0.3, 0.3, 1.0, 2.0); // Glow when in range

    if (forge.input.justPressed("interact")) {
      showingDialog = true;
      dialogTimer = 3.0;
      forge.ui.showText("npc_dialog", MESSAGES[messageIndex], 25, 70, { fontSize: 20, color: "#ffffff" });
      messageIndex = (messageIndex + 1) % MESSAGES.length;
    }
  } else if (dist >= TALK_RANGE) {
    forge.ui.removeText("npc_prompt");
    forge.setEmissive(entityId, 0, 0, 0, 0);
  }

  if (showingDialog) {
    dialogTimer -= dt;
    if (dialogTimer <= 0) {
      showingDialog = false;
      forge.ui.removeText("npc_dialog");
    }
  }
}`,
  },
  {
    id: 'day_night_cycle',
    name: 'Day/Night Cycle',
    description: 'Cycles ambient lighting and sky color over time',
    source: `// Day/Night Cycle - animates lighting over time
const CYCLE_DURATION = 60; // seconds for full day
let timeOfDay = 0.25; // Start at sunrise

function onStart() {
  forge.ui.showText("time", "Dawn", 90, 2, { fontSize: 14, color: "#ffcc66" });
}

function onUpdate(dt) {
  timeOfDay = (timeOfDay + dt / CYCLE_DURATION) % 1.0;

  // Calculate sun intensity based on time of day
  // 0=midnight, 0.25=sunrise, 0.5=noon, 0.75=sunset
  const sunAngle = timeOfDay * Math.PI * 2;
  const intensity = Math.max(0, Math.sin(sunAngle));

  // Sun color: warm at sunrise/sunset, white at noon
  const warmth = 1.0 - Math.abs(timeOfDay - 0.5) * 2;
  const r = Math.min(1, 0.5 + intensity * 0.5);
  const g = Math.min(1, 0.3 + intensity * 0.6 * warmth);
  const b = Math.min(1, 0.2 + intensity * 0.7 * warmth);

  // Apply to the directional light (sun)
  const lights = forge.scene.findByName("Sun");
  if (lights.length > 0) {
    forge.setColor(lights[0], r, g, b);
  }

  // Time label
  let label = "Night";
  if (timeOfDay > 0.2 && timeOfDay < 0.3) label = "Dawn";
  else if (timeOfDay >= 0.3 && timeOfDay < 0.7) label = "Day";
  else if (timeOfDay >= 0.7 && timeOfDay < 0.8) label = "Dusk";

  forge.ui.updateText("time", label);
}`,
  },
];
