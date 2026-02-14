# Post-Processing

Apply screen-space visual effects: bloom, chromatic aberration, color grading, and sharpening.

## Overview
Post-processing effects are applied to the final rendered image. They affect the entire viewport and are configured in Scene Settings (not per-entity).

## Effects

### Bloom
Makes bright areas glow and bleed light.

| Parameter | Range | Description |
|-----------|-------|-------------|
| Intensity | 0–1 | Overall bloom strength |
| Threshold | 0–10 | Minimum brightness to bloom |
| Knee | 0–1 | Soft threshold transition |

### Chromatic Aberration
Separates color channels at screen edges (lens effect).

| Parameter | Range | Description |
|-----------|-------|-------------|
| Intensity | 0–0.05 | Separation amount |

### Color Grading
Adjust overall image color balance.

| Parameter | Range | Description |
|-----------|-------|-------------|
| Exposure | -4–4 | Brightness adjustment |
| Gamma | 0.1–4 | Mid-tone curve |
| Saturation | 0–2 | Color intensity (0=greyscale) |
| Temperature | -1–1 | Warm (positive) / cool (negative) |
| Tint | -1–1 | Green / magenta shift |

### Contrast Adaptive Sharpening (CAS)
Enhances edge detail without amplifying noise.

| Parameter | Range | Description |
|-----------|-------|-------------|
| Strength | 0–1 | Sharpening intensity |

## Editor UI
1. Open **Scene Settings** (gear icon)
2. Navigate to the **Post-Processing** section
3. Toggle effects on/off and adjust parameters

## MCP Commands
```json
{"command": "set_post_processing", "params": {
  "bloom": {"enabled": true, "intensity": 0.3, "threshold": 1.0},
  "chromaticAberration": {"enabled": true, "intensity": 0.01},
  "colorGrading": {"enabled": true, "exposure": 0.5, "saturation": 1.2},
  "sharpening": {"enabled": true, "strength": 0.5}
}}
```

## Tips
- Bloom + emissive materials = neon glow effects
- Use chromatic aberration subtly (0.005–0.01) for a cinematic look
- Color grading exposure stacks with light intensity — adjust both for the desired look
- Post-processing is included in exported games

## Related
- [Lighting](./lighting.md) — affects what gets bloomed
- [Materials](./materials.md) — emissive materials trigger bloom
- [Custom Shaders](./custom-shaders.md) — per-entity effects
