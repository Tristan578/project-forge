# AutoForge

Autoresearch-style nightly optimization loop for SpawnForge's compound AI actions. Inspired by [Karpathy's autoresearch](https://github.com/karpathy/autoresearch) — but instead of optimizing ML training loss, AutoForge optimizes the quality of AI-generated game scenes.

## How It Works

1. **Nightly (Mon–Sat 11 PM):** Claude Code reads `program.md`, forms a hypothesis, makes ONE change to the compound action handlers, evaluates the result with heuristics + vision scoring, keeps improvements, discards regressions. Repeat up to 20 times. Wake up to a PR.

2. **Weekly (Sunday 2 AM):** Read-only validation run with real provider APIs (Meshy 3D, ElevenLabs audio, Suno music) to catch overfitting. Compares weekly scores against the nightly baseline and flags drift.

---

## Setup Guide (Step by Step)

### Prerequisites

Before starting, make sure you have these installed:

| Tool | Version | Check with | Install |
|------|---------|-----------|---------|
| Node.js | 22+ | `node -v` | [nodejs.org](https://nodejs.org) |
| Git | any | `git -v` | [git-scm.com](https://git-scm.com) |
| GitHub CLI | any | `gh --version` | `brew install gh` or [cli.github.com](https://cli.github.com) |
| Claude Code | any | `claude --version` | `npm install -g @anthropic-ai/claude-code` |

You also need:
- A **Vercel AI Gateway API key** (for vision scoring) — get one from [Vercel Dashboard → AI Gateway → API Keys](https://vercel.com/dashboard)
- A **Claude Code Max subscription** ($200/mo) — or an Anthropic API key — for the experiment loop itself
- To be logged into Claude Code: run `claude /login` if you haven't already
- To be logged into GitHub CLI: run `gh auth login` if you haven't already

### Step 1: Install dependencies

```bash
cd autoforge
npm install
npx playwright install chromium
```

**What this does:** Installs the Anthropic SDK and Playwright (headless browser for screenshotting scenes), then downloads the Chromium browser binary that Playwright uses.

### Step 2: Create your .env file

```bash
cp .env.example .env
```

Open `autoforge/.env` in your editor and set:

```bash
AI_GATEWAY_API_KEY=your-vercel-ai-gateway-key-here
```

That's the only **required** value. Everything else has sensible defaults.

**What this does:** The `.env` file configures which vision model to use, how many experiments to run per night, and optional API keys for the Sunday validation run. The AI Gateway key lets the vision scorer call Gemini 3 Flash (or any model you choose) through Vercel's zero-markup proxy.

### Step 3: Choose your vision model (optional)

The default vision model is `google/gemini-3-flash` — best bang for buck. If you want to change it, edit `VISION_MODEL` in your `.env`:

| Model | Cost/call | Monthly (20 exp/night) | Quality |
|-------|-----------|----------------------|---------|
| `google/gemini-3-flash` | $0.006 | ~$22 | 88% — **Default** |
| `google/gemini-3.1-flash-lite` | $0.003 | ~$11 | 82% — Budget |
| `google/gemini-3.1-pro` | $0.023 | ~$90 | 94% — Quality-first |
| `anthropic/claude-sonnet-4.6` | $0.032 | ~$125 | 95% — Overkill for scoring |

### Step 4: Validate the setup

```bash
npx tsx scripts/validate-setup.ts
```

**What this does:** Checks that all files exist, dependencies are installed, API keys are set, and tools are available. It will print `OK` or `FAIL` for each check. Fix any `FAIL` items before proceeding. `WARN` items are optional.

### Step 5: Run a test evaluation

In one terminal, start the SpawnForge dev server:
```bash
cd web && npm run dev
```

In another terminal, run a single heuristic evaluation (free, no API calls):
```bash
cd autoforge
npx tsx scripts/run-eval.ts --prompt forest-clearing
```

**What this does:** Opens a headless browser, navigates to `localhost:3000/dev`, executes the `create_scene_from_description` compound action with the "forest clearing" prompt, reads the scene graph, and scores it on 6 structural dimensions (entity count, material diversity, lighting, spatial distribution, component coverage, hierarchy). No API calls, no cost.

To test vision scoring too (costs ~$0.006):
```bash
npx tsx scripts/run-eval.ts --prompt forest-clearing --vision
```

**What this does:** Same as above, but also takes 3 screenshots from different camera angles and sends them to Gemini 3 Flash (via AI Gateway) for visual quality scoring on 5 dimensions.

### Step 6: Register the scheduled tasks

#### Windows
```powershell
# Nightly experiments (Mon-Sat 11 PM):
powershell -ExecutionPolicy Bypass -File autoforge\scripts\schedule-nightly.ps1 -Register

# Weekly validation (Sunday 2 AM):
powershell -ExecutionPolicy Bypass -File autoforge\scripts\schedule-weekly.ps1 -Register
```

#### macOS/Linux
```bash
# Nightly experiments (Mon-Sat 11 PM):
bash autoforge/scripts/schedule-nightly.sh --register

# Weekly validation (Sunday 2 AM):
bash autoforge/scripts/schedule-weekly.sh --register
```

**What this does:** Creates a cron job (macOS/Linux) or Windows Task Scheduler entry that runs automatically. Each night it pulls main, creates a branch, starts the dev server, runs Claude Code with the experiment prompt, and pushes a PR with any improvements. Sunday does the same but read-only — just measures and reports.

To unregister, replace `--register` / `-Register` with `--unregister` / `-Unregister`.

### Step 7: (Optional) Set up observability

For Sentry error tracking on the autoforge agents (separate from your production app):

1. Create a new Sentry project called `spawnforge-autoforge`
2. Add the DSN to your `.env`: `SENTRY_DSN=https://your-dsn@sentry.io/...`

For Vercel AI Gateway spend tracking, just use the Vercel dashboard — all API calls through the gateway are automatically logged with per-model cost breakdowns.

### Step 8: (Optional) Enable Sunday validation with real providers

Set any of these in your `.env` to enable real provider API calls during the weekly validation:

```bash
MESHY_API_KEY=your-key    # Real 3D model generation
ELEVENLABS_API_KEY=your-key  # Real audio/SFX generation
SUNO_API_KEY=your-key     # Real music generation
```

Without these, the Sunday run still works — it just runs the same vision scoring as the nightly loop, which is still useful for tracking score stability.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│  NIGHTLY (Mon–Sat 11 PM)                                │
│  schedule-nightly.ps1 / .sh                             │
│  ┌───────────────────────────────────────────────────┐  │
│  │  Claude Code -p (Max 20x sub, $0 incremental)    │  │
│  │  → Read program.md                                │  │
│  │  → Hypothesis → Edit ONE file → Verify (tsc/lint) │  │
│  │  → Evaluate (heuristics → vision)                 │  │
│  │  → Keep or discard → Loop                         │  │
│  └───────────────────────────────────────────────────┘  │
│  ┌──────────────────┐  ┌─────────────────────────────┐  │
│  │ Tier 1: Heuristic│  │ Tier 2: Vision Scoring      │  │
│  │ (FREE, ~2s)      │  │ Gemini 3 Flash via Gateway  │  │
│  │ 6 dimensions     │  │ (~$0.006/call, ~10s)        │  │
│  │ Score: 0-60      │  │ 5 dimensions, Score: 0-50   │  │
│  └──────────────────┘  └─────────────────────────────┘  │
│  → git commit improvements → PR                         │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  WEEKLY (Sunday 2 AM)                                   │
│  schedule-weekly.ps1 / .sh                              │
│  → Run eval with real provider APIs                     │
│  → Compare scores vs nightly baseline                   │
│  → Flag drift if weekly score drops >10%                │
│  → Push validation report PR                            │
└─────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────┐
│  OBSERVABILITY                                          │
│  ┌────────────────────┐  ┌────────────────────────────┐ │
│  │ Vercel AI Gateway  │  │ Sentry (separate project)  │ │
│  │ • Spend tracking   │  │ • Agent traces             │ │
│  │ • Per-model costs  │  │ • Token usage spans        │ │
│  │ • Request logs     │  │ • Error tracking           │ │
│  └────────────────────┘  └────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

## Directory Structure

```
autoforge/
├── .env.example            ← Copy to .env, set AI_GATEWAY_API_KEY
├── autoforge.config.ts     ← Central config (auto-detects everything)
├── package.json            ← Isolated deps (playwright, anthropic SDK)
├── tsconfig.json           ← TypeScript config
├── program.md              ← Steering file — tells Claude what to experiment with
├── README.md               ← You are here
├── prompts/                ← 10 benchmark scene descriptions (committed)
│   ├── 01-forest-clearing.json
│   ├── 02-medieval-village.json
│   └── ... (10 total)
├── scripts/
│   ├── run-eval.ts         ← Single evaluation pass (heuristic + optional vision)
│   ├── run-loop.ts         ← Loop state management and convergence logic
│   ├── eval-heuristics.ts  ← Tier 1: structural scoring (free, instant)
│   ├── eval-vision.ts      ← Tier 2: vision scoring via AI Gateway
│   ├── screenshot.ts       ← Playwright-based scene renderer
│   ├── validate-setup.ts   ← Pre-flight check
│   ├── schedule-nightly.ps1 ← Windows nightly scheduler (Mon-Sat 11 PM)
│   ├── schedule-nightly.sh  ← macOS/Linux nightly scheduler
│   ├── schedule-weekly.ps1  ← Windows weekly validator (Sunday 2 AM)
│   └── schedule-weekly.sh   ← macOS/Linux weekly validator
├── asset-cache/            ← Pre-generated provider outputs (gitignored)
└── results/                ← Experiment logs, scores, state (gitignored)
```

## Editable Surface

AutoForge only modifies these files:

- `web/src/lib/chat/handlers/compoundHandlers.ts` — primary target (1,200+ lines)
- `web/src/lib/chat/handlers/sceneManagementHandlers.ts`
- `web/src/lib/chat/handlers/gameplayHandlers.ts`
- `web/src/lib/chat/context.ts`

All other files are read-only to the experiment loop.

## Scoring

| Tier | Dimensions | Max | Cost | Speed |
|------|-----------|-----|------|-------|
| Heuristic | Entity count, material diversity, lighting, spatial distribution, component coverage, hierarchy | 60 | Free | ~2s |
| Vision | Composition, lighting, material quality, completeness, polish | 50 | ~$0.006/scene | ~10s |
| **Total** | | **110** | | |

## Cost Estimate

| Configuration | Per Night | Monthly |
|---------------|-----------|---------|
| Max sub + Gemini 3 Flash (default) | ~$0.75 | ~$200 + $22 |
| Max sub + Flash Lite (budget) | ~$0.37 | ~$200 + $11 |
| Max sub + Gemini 3.1 Pro (quality) | ~$2.99 | ~$200 + $90 |

Max 20x subscription ($200/mo) covers the Claude Code experiment loop at zero incremental cost. Only vision scoring incurs API charges, routed through Vercel AI Gateway (zero markup).
