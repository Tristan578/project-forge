# Game Components

Pre-built interactive behaviors you can attach to any entity in your scene — no scripting required for common game mechanics.

## Overview

Game Components are drag-and-drop behaviors that turn ordinary objects into interactive game elements. Instead of writing code to make a moving platform, a health system, or a collectible coin, you pick the component from a menu and configure it with sliders and checkboxes. Each entity can have multiple components attached at the same time.

## Using Game Components in the Editor

1. Select an entity in the **Scene Hierarchy** or viewport.
2. In the **Inspector Panel**, scroll to the **Game Components** section at the bottom.
3. Click the **Add** button to open the component picker menu.
4. Select a component type. It appears immediately with its default settings.
5. Adjust the properties using the sliders, number inputs, and checkboxes that appear.
6. To remove a component, click the trash icon in its header.

## Available Components

### Character Controller
Gives an entity player-controlled movement with physics-based walking and jumping.

| Property | Description |
|---|---|
| Speed | Movement speed (units/sec), range 0-20 |
| Jump Height | Peak height of a jump, range 0-20 |
| Gravity Scale | Multiplier on gravity, range 0-5 |
| Double Jump | Allow a second jump while airborne |

### Health
Adds hit points, invincibility frames, and optional respawn behavior.

| Property | Description |
|---|---|
| Max HP | Maximum health points (1-1000) |
| Invincibility | Seconds of invincibility after taking damage (0-5) |
| Respawn | Automatically respawn on death |
| Respawn Point | World position to respawn at |

### Collectible
Makes an entity collectible on contact, with optional visual spin.

| Property | Description |
|---|---|
| Value | Score/currency awarded when collected |
| Destroy | Destroy entity when collected |
| Rotate Speed | Degrees per second for idle spin animation |

### Damage Zone
An area that deals continuous or one-shot damage to entities that enter it. Requires the entity to also have a Physics collider set to Sensor mode.

| Property | Description |
|---|---|
| Damage/Sec | Damage points per second |
| One-Shot | Deal damage once then deactivate |

### Checkpoint
Marks a save point. When the player reaches this entity, their respawn position updates.

| Property | Description |
|---|---|
| Auto-Save | Write save data to storage automatically |

### Teleporter
Instantly moves any entity that touches it to a target world position, with a cooldown to prevent loops.

| Property | Description |
|---|---|
| Target Pos | World position (X, Y, Z) to teleport to |
| Cooldown | Seconds before the teleporter can activate again |

### Moving Platform
Moves between a list of waypoints on a loop. Add waypoints via the + button; drag the Vec3 inputs to position each stop.

| Property | Description |
|---|---|
| Speed | Movement speed between waypoints |
| Pause | Seconds to wait at each waypoint |
| Loop Mode | Ping-Pong (reverse), Loop (wrap), or Once |
| Waypoints | Ordered list of world positions |

### Trigger Zone
Fires a named game event when an entity enters or exits. Use scripts to listen for the event.

| Property | Description |
|---|---|
| Event Name | Name of the event to dispatch (e.g. "door_open") |
| One-Shot | Fire the event only once |

### Spawner
Periodically spawns new entities of the chosen type, respecting a maximum count cap.

| Property | Description |
|---|---|
| Entity Type | Shape to spawn: Cube, Sphere, Cylinder, Capsule |
| Interval | Seconds between each spawn (0.5-30) |
| Max Count | Maximum number of spawned entities alive at once |
| Offset | Spawn position relative to this entity |

### Follower
Chases a target entity, stopping at a configurable distance.

| Property | Description |
|---|---|
| Target ID | Entity ID to follow (leave blank to follow the player) |
| Speed | Pursuit speed |
| Stop Dist | Distance at which the follower stops moving |
| Look At | Rotate to face the target while following |

### Projectile
Gives an entity straight-line (or gravity-affected) movement intended for bullets or thrown objects.

| Property | Description |
|---|---|
| Speed | Forward speed (units/sec) |
| Damage | Damage dealt on impact |
| Lifetime | Seconds before auto-destroy |
| Gravity | Apply gravity to the projectile's trajectory |
| Destroy Hit | Destroy this entity on first collision |

### Win Condition
Defines a rule for winning the game. Choose Score, Collect All, or Reach Goal.

| Property | Description |
|---|---|
| Type | Score (reach target score), Collect All (pick up every collectible), Reach Goal (touch a specific entity) |
| Target Score | Required score for the Score type |
| Goal ID | Entity ID to reach for the Reach Goal type |

### Dialogue Trigger
Starts a dialogue tree when the player comes within range or presses an interact key. Requires a dialogue tree created in the **Dialogue Editor** panel.

| Property | Description |
|---|---|
| Tree | The dialogue tree to start |
| Radius | Distance at which the trigger activates |
| Require Interact | Wait for a key press rather than proximity alone |
| Key | Interaction key (default: E) |
| One Shot | Trigger the dialogue only once |

## Tips

- Multiple components can be stacked on the same entity. For example, attach both **Health** and **Character Controller** to your player entity.
- The **Damage Zone** only affects entities that also have a **Health** component.
- Use **Trigger Zone** with **Spawner** components by having a script listen for the trigger event and enabling the spawner: set the spawner entity's Trigger Zone event to a unique name, then listen for it in a script.
