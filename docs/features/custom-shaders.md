# Custom Shaders

Apply visual shader effects to entities: dissolve, hologram, force field, lava, toon, and fresnel glow.

## Overview
The Custom Shader Library provides 6 ready-made shader effects that extend the standard PBR material. Each effect has configurable parameters.

## Available Shaders

### Dissolve
Gradually dissolves the mesh surface using noise, revealing transparency.
- **progress** (0–1): How dissolved the surface is
- **edgeColor** (RGB): Color of the dissolve edge
- **edgeWidth** (0–0.5): Width of the glowing edge
- **noiseScale** (0.1–20): Scale of the noise pattern

### Hologram
Projects a holographic scan-line effect.
- **color** (RGB): Hologram tint color
- **lineSpeed** (0–10): Scan line scroll speed
- **lineSpacing** (0.1–5): Distance between scan lines
- **alpha** (0–1): Overall transparency
- **flickerSpeed** (0–20): Flicker rate

### Force Field
Transparent energy shield effect.
- **color** (RGB): Shield color
- **fresnelPower** (0.5–5): Edge glow falloff
- **pulseSpeed** (0–10): Pulse animation speed
- **gridScale** (1–50): Hexagonal grid density
- **hitPoint** (XYZ): Impact point for hit effect
- **hitIntensity** (0–5): Impact ripple strength

### Lava / Flow
Animated flowing surface (lava, water, energy).
- **color1** / **color2** (RGB): Blended flow colors
- **flowSpeed** (0–5): Animation speed
- **noiseScale** (0.1–10): Noise pattern scale
- **distortion** (0–2): Flow distortion amount
- **emissiveStrength** (0–10): Glow intensity

### Toon
Cel-shading effect with discrete light bands.
- **bands** (2–8): Number of shading steps
- **edgeThreshold** (0–1): Outline edge detection
- **edgeColor** (RGB): Outline color

### Fresnel Glow
Glowing edges based on view angle.
- **glowColor** (RGB): Edge glow color
- **fresnelPower** (0.5–5): Falloff curve
- **intensity** (0–10): Glow brightness

## MCP Commands
```json
{"command": "set_shader_effect", "params": {
  "entityId": "entity_1",
  "effect": "dissolve",
  "progress": 0.3,
  "edgeColor": [1.0, 0.5, 0.0],
  "edgeWidth": 0.05,
  "noiseScale": 5.0
}}

{"command": "set_shader_effect", "params": {
  "entityId": "entity_1",
  "effect": "hologram",
  "color": [0.0, 1.0, 0.8],
  "lineSpeed": 2.0,
  "alpha": 0.7
}}

{"command": "remove_shader_effect", "params": {"entityId": "entity_1"}}
```

## Editor UI
1. Select a mesh entity
2. In the Inspector, find the **Shader** section
3. Choose an effect from the dropdown
4. Adjust parameters with sliders

## Tips
- Shader effects **replace** the standard PBR material look — the base color still influences the result
- Dissolve is great for spawn/despawn animations (animate `progress` from 0→1)
- Hologram + Force Field work best on simple geometry
- Toon shader pairs well with dark outlines for a cartoon look
- Custom shaders support **undo/redo**

## Related
- [Materials](./materials.md) — PBR material properties
- [Post-Processing](./post-processing.md) — screen-space effects
- [Particles](./particles.md) — combine with particle effects
