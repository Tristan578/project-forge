# Physics Joints

Six types of physical constraints that connect two entities together, controlling how they can move relative to each other — with optional limits and motors.

## Overview

Physics Joints create mechanical connections between entities. A revolute joint makes a door hinge. A prismatic joint makes a piston. A rope joint keeps two objects within a maximum distance. Joints require both connected entities to have **Physics** components enabled (either Dynamic or Kinematic body type).

## Using Physics Joints in the Editor

1. Select the entity that will be the "source" of the joint (e.g. the door slab).
2. In the **Inspector Panel**, scroll to the **Joint** section. This section is only visible when the entity has Physics enabled.
3. Click **Add Joint**. The joint picker requires at least one other entity in the scene.
4. Choose the **Type** from the dropdown.
5. Set the **Connected To** entity — the other end of the joint.
6. Set **Anchor (Self)** and **Anchor (Other)** — world-space offsets on each entity where the joint attaches.
7. For revolute and prismatic joints, set the **Axis** (the direction of rotation or sliding).
8. Optionally enable **Limits** and/or **Motor** for constrained or driven motion.
9. To remove the joint, click **Remove** in the Joint section header.

## Joint Types

| Type | Description |
|---|---|
| Fixed | Locks both entities rigidly together — no relative movement |
| Revolute | Allows rotation around a single axis (like a hinge or wheel) |
| Spherical | Allows rotation in any direction (like a ball-and-socket joint) |
| Prismatic | Allows sliding along a single axis (like a piston or rail) |
| Rope | Limits maximum distance between entities — slack below the limit |
| Spring | Acts like a spring: pulls/pushes entities to a rest length |

## Properties

### All Joint Types

| Property | Description |
|---|---|
| Type | Joint type (see table above) |
| Connected To | The other entity this joint attaches to |
| Anchor (Self) | Local offset on this entity where the joint is attached |
| Anchor (Other) | Local offset on the connected entity where the joint is attached |

### Revolute and Prismatic

| Property | Description |
|---|---|
| Axis | The direction of rotation (Revolute) or sliding (Prismatic) as an X/Y/Z vector |

### Limits (Revolute, Prismatic, Rope)

Enable the **Limits** checkbox to constrain the range of motion.

| Property | Description |
|---|---|
| Min | Minimum angle in radians (Revolute), minimum slide distance (Prismatic), or ignored (Rope) |
| Max | Maximum angle in radians (Revolute), maximum slide distance (Prismatic), or maximum rope length (Rope) |

### Motor (Revolute and Prismatic)

Enable the **Motor** checkbox to drive the joint with a target velocity.

| Property | Description |
|---|---|
| Velocity | Target angular velocity (Revolute, rad/s) or linear velocity (Prismatic, units/s) |
| Max Force | Maximum force the motor can apply to reach the target velocity |

## Tips

- For a swinging door, use **Revolute** with a vertical axis of `[0, 1, 0]` and limits of `[-1.57, 1.57]` (approximately -90 to +90 degrees in radians).
- For a rope bridge, place a chain of entities each connected by a **Rope** joint with a short max distance.
- The **Spring** joint is useful for suspension systems — set the rest length and stiffness through the connected entity's physics properties after creating the joint.
