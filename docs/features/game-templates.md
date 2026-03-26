# Starter System Bundles (Game Templates)

A gallery of fully playable starter projects — select one when creating a new game to skip the blank-canvas setup and start customizing immediately.

## Overview

Starter System Bundles are pre-built scenes with entities, physics, scripts, input bindings, and materials already in place. Each bundle is a prepackaged configuration of independent systems (movement, camera, challenge, feedback, etc.) with a friendly genre label like "Platformer" or "Shooter." These labels are marketing shorthand, not constraints — every system in a bundle is independently editable, removable, and replaceable.

Bundles load directly into the editor as a normal scene, so every element is editable just like something you built yourself. You can also skip bundles entirely and describe any game in plain language — the AI will decompose your idea into systems and build it from scratch.

> **Key principle: Systems, not genres.** A "platformer" is really `movement:walk+jump` + `camera:side-scroll` + `challenge:physics` + `progression:levels`. The engine treats all system combinations equally, so you are never limited to predefined genre categories.

> **Naming note:** In the codebase, the UI component is still named `TemplateGallery` — the "Starter System Bundles" concept name describes the design philosophy, while the component name reflects its implementation.

## Using Starter Bundles in the Editor

1. Click the **New Scene** button in the toolbar (or press **Ctrl+Shift+N**).
2. The **Template Gallery** opens automatically when creating a new project. You can also open it from the **File** menu.
3. Browse the cards. Each card shows a difficulty badge, an entity count, and system tags.
4. Click any bundle card to load it, or click **Blank Project** to start from scratch. You can also type a free-text game description into the AI chat to build something entirely custom.
5. The bundle loads as your current scene — explore the hierarchy to see how it is built.

## Available Templates

### 3D Templates

| Template | Difficulty | Description |
|---|---|---|
| 3D Platformer | Beginner | Jump between floating platforms, collect coins, reach the goal flag. Uses physics, collectibles, and a win condition. |
| Endless Runner | Beginner | Auto-run forward, dodge obstacles, chase a high score. Features a procedural obstacle system and score counter. |
| Arena Shooter | Intermediate | First-person shooting gallery. Hit targets, rack up points. Includes projectile physics and target spawners. |
| Block Puzzle | Intermediate | Push blocks onto pressure plates to open doors and escape. Uses physics-based object interaction and trigger zones. |
| Walking Simulator | Beginner | Explore a serene environment. Find glowing orbs, discover story fragments. Minimal mechanics, ambient lighting. |

### 2D Templates

| Template | Difficulty | Description |
|---|---|---|
| 2D Platformer | Beginner | Side-scrolling platformer with jumps, enemies, and collectibles. |
| 2D Top-Down RPG | Beginner | Zelda-style adventure. Explore, talk to NPCs, collect items. Includes dialogue trees. |
| 2D Shoot-em-up | Intermediate | Vertical scrolling shooter. Dodge bullets, defeat waves of enemies. |
| 2D Puzzle Game | Intermediate | Match-3 puzzle game. Swap tiles to create matches. |
| 2D Fighter | Intermediate | Two-player fighting game. Attack, defend, knockout opponent. |
| 2D Metroidvania | Intermediate | Exploration platformer. Unlock abilities, save progress, discover secrets. |

## What Is Included in Each Bundle

Each starter bundle provides a preconfigured set of independent systems:

- **World system** — A complete scene with entities already positioned and sized
- **Physics system** — Collider configuration on relevant objects
- **Movement + AI systems** — Scripts for player movement, enemy behavior, and game mechanics
- **Input system** — Key bindings preset for the bundle's play style (side-scroll, FPS, top-down, etc.)
- **Visual system** — Materials and lighting tuned for the visual style
- **Challenge system** — A win/lose condition wired up and ready to test

Every system listed above is independently editable. Swap the camera from side-scroll to top-down, replace the movement system, add new feedback systems — the bundle is a starting point, not a box.

## Tips

- After loading a bundle, press **Play** immediately to try it out before making any changes — this helps you understand what the working game looks like.
- The Scene Hierarchy is the best place to explore how a bundle is structured. Each entity is named descriptively so you can find the Player, enemies, and platforms quickly.
- Beginner bundles use simpler scripts and fewer systems — start with one of those if you are new to the editor.
- Remember: bundles are starting points. You can describe any game idea to the AI chat and it will decompose your description into systems and build it, with or without a bundle as a base.
