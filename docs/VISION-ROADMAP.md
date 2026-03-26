# SpawnForge Vision Roadmap: Prompt → Complete Game

> **Disclaimer:** This document describes planned and in-development capabilities, not shipped features. The phased roadmap below represents our target vision. Individual capabilities will ship incrementally as tickets are completed. For current shipped features, see [README.md](../README.md).

> Created: 2026-03-16 | 20 capabilities across 4 tiers
> Goal: A single prompt will produce a complete, playable, balanced, accessible game

---

## Implementation Phases (by feasibility + impact)

### Phase V1: Foundation (Weeks 1-4) — "Make it work"
*Build on existing infrastructure. Incremental, not infrastructure-heavy. Core principle: systems, not genres — the AI decomposes any game description into composable systems (movement, camera, challenge, feedback, etc.) rather than matching to genre templates.*

| # | Ticket | Effort | Dependencies | Can Start Now? |
|---|--------|--------|-------------|---------------|
| 1 | **PF-541** GDD Generator | 1 week | None — extends compound actions | **YES** |
| 2 | **PF-547** Event→Effect System (juice + sound) | 1 week | None — new store + script API | **YES** |
| 3 | **PF-543** Physics Feel Profiler | 3 days | None — reads existing physics | **YES** |
| 4 | **PF-545** Behavior Tree DSL | 1 week | None — compiles to existing script API | **YES** |
| 5 | **PF-558** Auto-Tutorial Generator | 3 days | PF-541 (GDD) | After PF-541 |

**Phase V1 outcome:** "Describe any game" → AI decomposes the idea into systems (movement, camera, challenge, feedback, etc.), creates a GDD, generates the level, wires sound/juice, adds enemy AI, creates a tutorial. Playable in 2-3 AI turns.

### Phase V2: Quality (Weeks 5-8) — "Make it good"
*AI understanding and feedback loops.*

| # | Ticket | Effort | Dependencies | Notes |
|---|--------|--------|-------------|-------|
| 6 | **PF-546** Art Style Engine | 1 week | Asset generation exists | Palette lock + style reference |
| 7 | **PF-548** Procedural Level Generator | 2 weeks | Tilemap + CSG exist | BSP + WFC algorithms |
| 8 | **PF-549** Narrative Arc Generator | 1 week | Dialogue system exists | Story graph + character profiles |
| 9 | **PF-544** Gameplay Bot | 2 weeks | Physics + pathfinding | A* on tilemap, exploration AI |
| 10 | **PF-550** Auto-Rigging | 2 weeks | Skeleton2D exists | Needs Mixamo API or custom WASM |

**Phase V2 outcome:** Describe a roguelike (or any genre blend) → AI decomposes into systems: procedural world generation, consistent art style, enemy AI with behavior trees, narrative progression connecting levels, auto-rigged characters.

### Phase V3: Polish (Weeks 9-12) — "Make it complete"
*Accessibility, localization, difficulty.*

| # | Ticket | Effort | Dependencies | Notes |
|---|--------|--------|-------------|-------|
| 11 | **PF-559** Accessibility Auto-Gen | 1 week | Export pipeline exists | Settings menu + shader modes |
| 12 | **PF-561** One-Click Localization | 3 days | i18n infrastructure (PF-369) merged | Claude translation API |
| 13 | **PF-552** Dynamic Difficulty | 1 week | GameComponent system | Runtime stat adjustment |
| 14 | **PF-554** Instant Multiplayer (Tier 1) | 2 weeks | Input system exists | Local co-op, split-screen |

**Phase V3 outcome:** Every game is accessible, localized, difficulty-adaptive, and optionally co-op. Ready for global audience.

### Phase V4: Platform (Months 4-6) — "Make it viral"
*Network effects, analytics, learning.*

| # | Ticket | Effort | Dependencies | Notes |
|---|--------|--------|-------------|-------|
| 15 | **PF-551** Live Analytics | 2 weeks | Publish pipeline exists | Lightweight SDK in exports |
| 16 | **PF-553** AI Auto-Iteration | 1 week | PF-551 (analytics) + PF-541 (GDD) | Closes the flywheel |
| 17 | **PF-555** Game Remix/Fork | 1 week | Publish + projects exist | DB schema + attribution |
| 18 | **PF-557** Player UGC Toolkit | 2 weeks | Export + tilemap exist | Simplified editor in export |
| 19 | **PF-560** Platform Learning | 3 weeks | PF-551 (analytics) at scale | Aggregate intelligence |
| 20 | **PF-556** Voice+Vision | [RESEARCH] | Multimodal API cost validation | May defer or simplify |

**Phase V4 outcome:** Published games generate data that makes the platform smarter. Players become creators through remix and UGC. SpawnForge becomes a flywheel, not just a tool.

---

## Dependency Graph

```
                    PF-541 GDD Generator
                   /        |          \
          PF-548 Levels   PF-558 Tutorial  PF-549 Narrative
              |                               |
          PF-544 Bot ←─────────────────── PF-552 DDA
              |
          PF-551 Analytics
           /        \
     PF-553 Auto-Fix  PF-560 Learning

PF-546 Art Style ──→ All asset generation
PF-547 Event→Effects ──→ All gameplay interactions
PF-545 Behavior Trees ──→ All NPC behavior
PF-550 Auto-Rigging ──→ All 3D characters
PF-559 Accessibility ──→ All exports
PF-561 Localization ──→ All exports
PF-554 Multiplayer ──→ Export pipeline
PF-555 Remix ──→ Publish system
PF-557 UGC ──→ PF-555 Remix
```

---

## The "One Prompt" Test

**Input:** "Make a fantasy roguelike with dark theme, 3 enemy types, a shopkeeper, adaptive music, and a story about breaking a curse"

**What will happen with all 20 capabilities:**

1. **PF-541** will generate GDD: mechanics, entities, assets, progression
2. **PF-546** will establish dark fantasy palette + style reference
3. **PF-548** will generate 5-level procedural dungeon with difficulty scaling
4. **PF-550** will auto-rig 3D character + 3 enemy models from Meshy
5. **PF-545** will compile enemy behaviors: "skeleton patrols, attacks <5m, flees <20% HP"
6. **PF-549** will generate story arc: mentor → quest → betrayal → choice → resolution
7. **PF-547** will wire juice: screenshake on hit, sparkles on loot, slowmo on boss kill
8. **PF-543** will tune physics to "fast Dark Souls" feel
9. **PF-558** will generate tutorial level teaching move, attack, dodge, collect
10. **PF-559** will add colorblind mode, subtitles, difficulty options
11. **PF-561** will localize to 10 languages
12. **PF-544** bot will playtest: "Boss HP too high, level 3 has unreachable chest"
13. AI will fix issues and publish game
14. **PF-552** will adapt difficulty per player at runtime
15. **PF-551** will track: "60% completion, level 4 is dropout point"
16. **PF-553** creator says "fix level 4" → AI will redesign + republish
17. **PF-555** players will remix the game with their own dungeons
18. **PF-557** players will create and share custom levels
19. **PF-560** platform will learn: dark fantasy roguelikes with these physics feel best
20. Next dark fantasy roguelike will be even better

**Target result:** A polished, accessible, localized, balanced, living game — from one sentence.

---

## Competitive Positioning with Vision

| Capability | SpawnForge (Vision) | Unity | Unreal | GDevelop | Rosebud |
|-----------|:---:|:---:|:---:|:---:|:---:|
| One-prompt game creation | **Full pipeline** | No | No | Partial | Shallow |
| AI behavior trees | **English→compiler** | Manual | Manual | Events | No |
| Auto-rigging | **Instant** | Via Mixamo | Via Mixamo | N/A | N/A |
| Procedural levels | **Constraint-based** | Manual/plugins | Manual/plugins | Limited | No |
| Auto-tutorial | **From GDD** | Manual | Manual | Manual | No |
| Accessibility auto-gen | **Default on** | Manual | Manual | Partial | No |
| One-click localization | **10 languages** | Plugins | Plugins | Manual | No |
| Live analytics | **Built-in** | Unity Analytics | Unreal Insights | No | No |
| AI auto-iteration | **Analytics→Fix→Republish** | No | No | No | No |
| Game remix/UGC | **Platform feature** | No | Fortnite Creative | No | No |
| Platform learning | **Aggregate intelligence** | No | No | No | No |

**SpawnForge wins 11/11 categories on the vision roadmap.** No competitor is building this complete a pipeline.

---

## Final Vision: 43 Active Capabilities (10 iterations, 2026-03-16)

### By Category

| Category | Count | Capabilities |
|----------|-------|-------------|
| **Inspiration** | 1 | Game Idea Generator |
| **Education** | 1 | Game Design Teacher |
| **Creation** | 9 | GDD, AI Studio, Level Gen, Quest Gen, World-Building, Economy, Tutorial, Cutscenes, Incremental Mod |
| **Quality** | 8 | Physics, Art Style, Camera, Behavior Trees, Narrative, Auto-Rig, Proc Animation, Texture Painter |
| **Runtime** | 7 | Event→Effects, DDA, Learning NPCs, Adaptive Music, Auto-Save, Live Narrative, Cross-Game Universe |
| **Feedback** | 4 | Gameplay Bot, AI Reviewer, Emotional Pacing, Auto-Iteration |
| **Polish** | 3 | Accessibility, Localization, Juice |
| **Publishing** | 3 | Auto-Trailer, Native App Wrapper, Monetization |
| **Platform** | 6 | Analytics, Remix, UGC, Social, Learning, Game Portals |
| **Research** | 1 | Voice+Vision |

### Power Ranking: Top 10 Most Transformative

1. **PF-575 AI Game Studio** — Parallel specialist agents (10x creation speed)
2. **PF-541 GDD Generator** — Structured game design from single prompt (foundation for everything)
3. **PF-576 Incremental Modification** — "Change just this" without regenerating (creative partnership)
4. **PF-577 Game Design Teacher** — Teaches WHY, not just WHAT (educational revolution)
5. **PF-553 Auto-Iteration Loop** — Analytics → diagnose → fix → republish (the flywheel)
6. **PF-582 Live Narrative** — Story that responds to player actions no one planned
7. **PF-547 Event→Effect System** — Automatic game feel for every interaction
8. **PF-548 Level Generator** — Constraint-based procedural levels
9. **PF-559 Accessibility Auto-Gen** — Every game accessible by default
10. **PF-560 Platform Learning** — Every game makes the platform smarter (ultimate moat)

### The Test: "One Prompt → Complete Game"

**Prompt:** "Make a fantasy roguelike with dark theme, 3 enemy types, a shopkeeper, adaptive music, and a story about breaking a curse"

**With all 43 capabilities, here is what will happen:**

```
0:00  PF-573 Game Idea will refine concept → "Dark Souls meets Binding of Isaac"
0:01  PF-541 GDD will generate structured design document
0:02  PF-575 AI Studio will dispatch 6 specialist agents:
        Art Director → dark fantasy palette (PF-546)
        Level Designer → 5 procedural dungeon floors (PF-548)
        Sound Designer → adaptive combat music (PF-581) + SFX (PF-547)
        Narrative Designer → curse-breaking story arc (PF-549) + 3 quests (PF-569)
        Character Designer → auto-rigged hero + 3 enemies (PF-550)
        World Builder → lore + faction setup (PF-567)
0:05  All agents will sync → Producer will resolve dependencies
0:06  PF-558 Tutorial level will be generated teaching controls
0:07  PF-565 Smart camera will be configured for top-down combat
0:08  PF-543 Physics will be tuned to "fast Dark Souls" feel
0:09  PF-566 Economy will be balanced: gold, potions, weapon upgrades
0:10  PF-568 Auto-save system will be wired to checkpoints
0:11  PF-547 Juice will be wired: screenshake on hit, sparkles on loot
0:12  PF-544 Gameplay bot will play → "Boss 3 HP too high by 25%"
0:13  PF-562 AI reviewer will report: "7/10 — needs more enemy variety"
0:14  PF-572 Emotional pacing will flag: "Level 2 has flat tension — add ambush"
0:15  AI will fix all three issues automatically
0:16  PF-559 Accessibility will be added: colorblind mode, subtitles, motor options
0:17  PF-561 Will be localized to 10 languages
0:18  PF-578 Auto-trailer will be generated: 30s gameplay video
0:19  Will be published with analytics (PF-551), social features (PF-571)
0:20  PF-552 DDA will adapt to each player's skill at runtime
0:21  PF-580 NPCs will learn from player behavior across sessions
0:22  PF-582 Live narrative will respond to unexpected player choices

Post-publish:
  PF-553 Analytics → AI will auto-fix dropout points
  PF-555 Players will remix with their own dungeons
  PF-557 Players will create and share custom levels
  PF-574 Creator will earn revenue via rewarded ads
  PF-560 Platform will learn: dark roguelikes work best with these physics
  PF-584 Creator will connect their game to other SpawnForge worlds
```

**Target time: ~20 minutes from prompt to published, polished, accessible, localized, balanced game.**

That's the art of the possible.
