# SpawnForge — Go-to-Market Strategy

> Last updated: 2026-03-16
> Companion to: competitive-analysis.md

---

## 1. Market Entry Strategy

### Primary Wedge: Zero-Friction Game Creation
The #1 barrier to game development is setup friction. Unity requires 2-5GB download + project configuration. Unreal requires 40GB+ and a gaming PC. SpawnForge requires: open a browser tab.

**Entry hook:** "Describe your game and play it in 60 seconds" — the AI executes compound actions to assemble a playable game from your description. No genre selection, no template constraints — just describe what you want. The planned Game Creation Orchestrator will decompose ideas into composable systems (movement, camera, challenge, feedback, etc.) and coordinate specialist agents for even faster creation. No sign-up required for the first session (localStorage-only).

### Target Segments (Priority Order)

| Segment | Size | Entry Hook | Conversion Path | LTV |
|---------|------|-----------|----------------|-----|
| **Game jam participants** | 500K+ annually | "Prototype in minutes, not hours" | Free → Starter ($29/mo) for export | Medium |
| **CS/game design students** | 2M+ globally | "Learn game dev without Unity overhead" | Free → Educational tier (discounted) | Low (but viral) |
| **Indie developers** | 300K+ active | "Professional tools, zero install" | Starter → Creator ($79/mo) for AI gen | High |
| **Content creators/streamers** | 100K+ | "Build games live on stream" | Creator → Pro ($199/mo) for collab | Very High |
| **Educators** | 50K+ | "Teach game design in any browser" | Institutional licensing | Very High |

### Distribution Channels

| Channel | Strategy | Cost | Expected CAC |
|---------|----------|------|-------------|
| **Organic SEO** | Target "AI game maker", "browser game engine", "make games online" | $0 | $0 (long-term) |
| **Game jam sponsorship** | Sponsor Ludum Dare, GMTK Jam, js13kGames | $500-2K/event | $2-5/user |
| **YouTube/Twitch** | Partner with game dev creators for tutorials | $1-5K/creator | $3-8/user |
| **Reddit/HackerNews** | Launch posts, community engagement | $0 | $0 |
| **ProductHunt** | Launch day campaign | $0 | $1-3/user |
| **University partnerships** | Free educational accounts, curriculum integration | $0 (loss leader) | $0 (viral) |
| **Dev tool marketplaces** | List on itch.io tools, Game Dev Marketplace | $0 | $5-10/user |

---

## 2. Pricing Strategy

### Current Tiers (Validated)

| Tier | Price | Token Budget | Key Features | Target Persona |
|------|-------|-------------|--------------|----------------|
| **Free** | $0 | 50 AI tokens/mo | Editor, templates, export (watermark) | Trial users, students |
| **Starter** | $29/mo | 500 tokens/mo | No watermark, BYOK AI keys, cloud save | Hobbyists, jam participants |
| **Creator** | $79/mo | 2,000 tokens/mo | Platform AI (Claude, Meshy, etc.), publish | Indie developers |
| **Pro** | $199/mo | 5,000 tokens/mo | Priority generation, collaboration (future) | Teams, content creators |

### Revenue Model Analysis

| Revenue Stream | Year 1 Target | Year 2 Target | Notes |
|---------------|--------------|---------------|-------|
| Subscriptions | $50K ARR | $500K ARR | Primary — predictable MRR |
| Token top-ups | $10K | $100K | Burst usage (game jams, deadlines) |
| Marketplace commission | $0 | $50K | 15% on community asset sales |
| Educational licensing | $0 | $100K | Per-seat institutional deals |

### Key Metric Targets

| Metric | Month 1 | Month 6 | Month 12 |
|--------|---------|---------|----------|
| MAU (Monthly Active Users) | 500 | 5,000 | 20,000 |
| Paid conversion rate | 2% | 5% | 8% |
| Paying customers | 10 | 250 | 1,600 |
| MRR | $500 | $12,500 | $80,000 |
| Churn rate | N/A | 8% | 5% |
| NPS | N/A | 40+ | 50+ |

---

## 3. Competitive Defensibility

### Moat Analysis

| Moat Type | SpawnForge Asset | Time to Replicate |
|-----------|-----------------|-------------------|
| **Engine depth** | Bevy/WASM with WebGPU, Rapier physics, skeletal animation | 12-18 months |
| **AI command surface** | 350+ MCP commands across 41 categories | 6-12 months |
| **Multi-provider integration** | 5 AI providers (Meshy, ElevenLabs, Suno, DALL-E, Replicate) | 3-6 months |
| **Export pipeline** | Standalone HTML5 + cloud publish | 3-6 months |
| **Community content** | Templates, scripts, asset library | 6-12 months (network effect) |

### Competitive Response Plan

| If Competitor Does... | Our Response |
|----------------------|-------------|
| GDevelop adds AI chat | Highlight engine depth gap (no 3D, no physics, no shaders) |
| Unity launches browser editor | Highlight zero-install + AI-native (Unity AI is bolt-on) |
| Rosebud adds manual editing | Highlight MCP command depth + scripting + export |
| New entrant with VC funding | Accelerate community features (marketplace, templates) for network effect |
| Google/Apple enters market | Focus on open-ness and creator ownership (no platform lock-in) |

---

## 4. Retention Strategy

### Week 1: Activation
- **Day 0:** AI builds first game from a description in <60s
- **Day 1:** Email: "Your game is live at spawnforge.ai/play/..." (publish nudge)
- **Day 3:** Email: "Try these 3 modifications to your game" (engagement)
- **Day 7:** Email: "Upgrade to Starter — export without watermark" (conversion)

### Month 1: Habit Formation
- **Weekly challenges:** "Build a game with these systems this week" (community + starter bundles)
- **Achievement system:** Badges for first publish, first AI generation, first script
- **Community gallery:** Feature top games on homepage (social proof)

### Month 3+: Deepening
- **Skill progression:** Visual scripting → TypeScript → MCP automation
- **Community participation:** Asset sharing, template creation, game jams
- **Creator program:** Revenue share for top template/asset creators

### Churn Prevention Signals

| Signal | Detection | Intervention |
|--------|-----------|-------------|
| No login for 7 days | Usage analytics | Email: "Your project misses you" + what's new |
| Token balance depleted | Token service | In-app: "Buy tokens" or "Upgrade tier" banner |
| Export failed | Error tracking | Support email with fix instructions |
| AI generation quality complaint | Feedback system | Offer manual editing tutorial |

---

## 5. Launch Plan

### Pre-Launch (2 weeks before)
- [ ] Landing page live with email capture
- [ ] 3 demo videos (60s each): create, customize, publish
- [ ] Beta tester testimonials (if available)
- [ ] Press kit: screenshots, logo, founder bio, feature list

### Launch Day
- [ ] ProductHunt submission (schedule for Tuesday 12:01 AM PT)
- [ ] HackerNews "Show HN" post
- [ ] Reddit posts: r/gamedev, r/indiegaming, r/webdev, r/programming
- [ ] Twitter/X thread: "We built a game engine that runs in your browser"
- [ ] YouTube creator partnerships go live

### Post-Launch (Week 1-4)
- [ ] Monitor: signup rate, activation rate, first-game-created rate
- [ ] Respond to all feedback (HN comments, Reddit, Twitter)
- [ ] Fix top 3 user-reported issues within 48 hours
- [ ] Publish "Week 1 learnings" blog post (transparency builds trust)

---

## 6. Investor Narrative

### One-Liner
"SpawnForge is the Canva for games — an AI-native game engine that runs entirely in the browser."

### Problem
Game creation requires installing 2-40GB of desktop software, learning complex interfaces, and managing build pipelines. 95% of people who want to make games never start because the tools are too intimidating.

### Solution
SpawnForge eliminates every barrier: zero install (browser tab), AI-assisted creation (natural language), professional engine depth (WebGPU, physics, shaders), and one-click publishing.

### Market
- $200B+ gaming market, growing 8% annually
- 500K+ game jam participants annually
- 2M+ game design students globally
- $5B+ creator economy in gaming

### Traction (Target for Seed)
- 13,600+ unit tests, 350 MCP commands, 11 starter system bundles
- Full export pipeline (HTML5 + cloud publish)
- Multi-provider AI integration (5 providers)
- Subscription billing live (Stripe)

### Ask
Seed round to fund: marketing (landing page, content), infrastructure (CDN, scaling), and team (2 engineers, 1 designer, 1 community manager).
