/**
 * Emotional Pacing Analyzer
 *
 * Analyzes game scenes for emotional pacing — mapping tension, excitement,
 * and calm across level progression. Compares against genre templates and
 * provides improvement suggestions.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EmotionType = 'tension' | 'excitement' | 'calm' | 'fear' | 'wonder';

export interface PacingPoint {
  /** Normalized position in the level (0–1) */
  position: number;
  /** Emotion intensity (0–1) */
  intensity: number;
  /** Which emotion dominates at this point */
  emotion: EmotionType;
  /** Human-readable label for this moment */
  label: string;
}

export interface PacingCurve {
  /** Ordered sequence of pacing points */
  points: PacingPoint[];
  /** Overall dominant emotion across the curve */
  dominantEmotion: EmotionType;
  /** Average intensity across the curve */
  averageIntensity: number;
  /** Variance in intensity — low = monotonous, high = dynamic */
  variance: number;
}

export interface PacingIssue {
  severity: 'info' | 'warning' | 'error';
  position: number;
  message: string;
  suggestion: string;
}

export interface PacingSuggestion {
  title: string;
  description: string;
  /** Position range this suggestion applies to [start, end] */
  range: [number, number];
  priority: 'low' | 'medium' | 'high';
}

export interface PacingAnalysis {
  curve: PacingCurve;
  issues: PacingIssue[];
  suggestions: PacingSuggestion[];
  /** Overall pacing score 0–100 */
  score: number;
  /** Name of the template used for comparison (if any) */
  comparedTemplate: string | null;
}

export type PacingTemplateId =
  | 'action_adventure'
  | 'horror'
  | 'puzzle'
  | 'narrative';

export interface PacingTemplate {
  id: PacingTemplateId;
  name: string;
  description: string;
  curve: PacingCurve;
}

// ---------------------------------------------------------------------------
// Scene entity descriptor (what the analyzer reads from a scene)
// ---------------------------------------------------------------------------

export interface SceneEntityDescriptor {
  id: string;
  name: string;
  type: string;
  /** Normalized position along level progression axis (0–1) */
  position: number;
  /** Tags that hint at emotional weight */
  tags: string[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function variance(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  let sum = 0;
  for (const v of values) sum += (v - avg) * (v - avg);
  return sum / values.length;
}

function dominantEmotion(points: PacingPoint[]): EmotionType {
  const counts: Record<EmotionType, number> = {
    tension: 0,
    excitement: 0,
    calm: 0,
    fear: 0,
    wonder: 0,
  };
  for (const p of points) {
    counts[p.emotion] += p.intensity;
  }
  let best: EmotionType = 'calm';
  let bestVal = -1;
  for (const [k, v] of Object.entries(counts)) {
    if (v > bestVal) {
      bestVal = v;
      best = k as EmotionType;
    }
  }
  return best;
}

function buildCurve(points: PacingPoint[]): PacingCurve {
  const sorted = [...points].sort((a, b) => a.position - b.position);
  const intensities = sorted.map((p) => p.intensity);
  return {
    points: sorted,
    dominantEmotion: dominantEmotion(sorted),
    averageIntensity: mean(intensities),
    variance: variance(intensities),
  };
}

// ---------------------------------------------------------------------------
// Tag → emotion mapping
// ---------------------------------------------------------------------------

const TAG_EMOTION_MAP: Record<string, { emotion: EmotionType; weight: number }> = {
  // Tension
  enemy: { emotion: 'tension', weight: 0.7 },
  boss: { emotion: 'tension', weight: 0.95 },
  trap: { emotion: 'tension', weight: 0.6 },
  hazard: { emotion: 'tension', weight: 0.5 },
  timer: { emotion: 'tension', weight: 0.6 },
  // Excitement
  combat: { emotion: 'excitement', weight: 0.8 },
  explosion: { emotion: 'excitement', weight: 0.9 },
  speed: { emotion: 'excitement', weight: 0.7 },
  chase: { emotion: 'excitement', weight: 0.85 },
  reward: { emotion: 'excitement', weight: 0.5 },
  // Calm
  safe: { emotion: 'calm', weight: 0.8 },
  checkpoint: { emotion: 'calm', weight: 0.6 },
  rest: { emotion: 'calm', weight: 0.9 },
  dialogue: { emotion: 'calm', weight: 0.5 },
  shop: { emotion: 'calm', weight: 0.7 },
  // Fear
  dark: { emotion: 'fear', weight: 0.6 },
  jumpscare: { emotion: 'fear', weight: 0.95 },
  horror: { emotion: 'fear', weight: 0.8 },
  monster: { emotion: 'fear', weight: 0.7 },
  // Wonder
  vista: { emotion: 'wonder', weight: 0.8 },
  reveal: { emotion: 'wonder', weight: 0.9 },
  discovery: { emotion: 'wonder', weight: 0.7 },
  secret: { emotion: 'wonder', weight: 0.6 },
  cutscene: { emotion: 'wonder', weight: 0.5 },
};

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

function makePoints(
  data: Array<[number, number, EmotionType, string]>,
): PacingPoint[] {
  return data.map(([position, intensity, emotion, label]) => ({
    position,
    intensity,
    emotion,
    label,
  }));
}

const ACTION_ADVENTURE_POINTS = makePoints([
  [0.0, 0.3, 'calm', 'Opening — establish setting'],
  [0.1, 0.5, 'excitement', 'Hook — initial action beat'],
  [0.2, 0.4, 'calm', 'Breathing room'],
  [0.35, 0.7, 'tension', 'Rising stakes'],
  [0.5, 0.5, 'calm', 'Midpoint rest'],
  [0.65, 0.8, 'excitement', 'Escalation'],
  [0.8, 0.6, 'tension', 'Pre-climax tension'],
  [0.9, 1.0, 'excitement', 'Climax'],
  [1.0, 0.3, 'calm', 'Resolution'],
]);

const HORROR_POINTS = makePoints([
  [0.0, 0.2, 'calm', 'False safety'],
  [0.1, 0.4, 'tension', 'Something feels wrong'],
  [0.2, 0.6, 'fear', 'First scare'],
  [0.3, 0.3, 'calm', 'Brief relief'],
  [0.4, 0.7, 'fear', 'Escalating dread'],
  [0.55, 0.5, 'tension', 'Sustained unease'],
  [0.7, 0.85, 'fear', 'Major fright'],
  [0.8, 0.4, 'tension', 'Temporary reprieve'],
  [0.9, 1.0, 'fear', 'Terror climax'],
  [1.0, 0.2, 'calm', 'Aftermath'],
]);

const PUZZLE_POINTS = makePoints([
  [0.0, 0.3, 'calm', 'Introduction'],
  [0.15, 0.4, 'wonder', 'Discovery — new mechanic'],
  [0.3, 0.5, 'tension', 'First challenge'],
  [0.45, 0.3, 'calm', 'Comprehension pause'],
  [0.55, 0.6, 'tension', 'Complexity ramp'],
  [0.7, 0.7, 'excitement', 'Breakthrough moment'],
  [0.85, 0.8, 'tension', 'Final puzzle'],
  [1.0, 0.4, 'wonder', 'Reward reveal'],
]);

const NARRATIVE_POINTS = makePoints([
  [0.0, 0.2, 'calm', 'Establishing scene'],
  [0.1, 0.4, 'wonder', 'World introduction'],
  [0.25, 0.5, 'tension', 'Inciting incident'],
  [0.4, 0.6, 'excitement', 'Rising action'],
  [0.5, 0.4, 'calm', 'Reflection beat'],
  [0.65, 0.7, 'tension', 'Complications'],
  [0.8, 0.9, 'excitement', 'Climax'],
  [0.9, 0.5, 'calm', 'Falling action'],
  [1.0, 0.3, 'wonder', 'Denouement'],
]);

export const PACING_TEMPLATES: Record<PacingTemplateId, PacingTemplate> = {
  action_adventure: {
    id: 'action_adventure',
    name: 'Action / Adventure',
    description:
      'Classic hero arc: hook, rising stakes, midpoint rest, escalation, climax, resolution.',
    curve: buildCurve(ACTION_ADVENTURE_POINTS),
  },
  horror: {
    id: 'horror',
    name: 'Horror',
    description:
      'Slow-burn dread with peaks of fear, brief relief valleys, and a terror climax.',
    curve: buildCurve(HORROR_POINTS),
  },
  puzzle: {
    id: 'puzzle',
    name: 'Puzzle / Strategy',
    description:
      'Gradual complexity ramp with discovery moments and a satisfying breakthrough.',
    curve: buildCurve(PUZZLE_POINTS),
  },
  narrative: {
    id: 'narrative',
    name: 'Narrative / Story-Driven',
    description:
      'Classic three-act structure with emotional peaks anchored to story beats.',
    curve: buildCurve(NARRATIVE_POINTS),
  },
};

// ---------------------------------------------------------------------------
// Scene Analysis
// ---------------------------------------------------------------------------

/**
 * Analyze an array of scene entity descriptors and produce a pacing curve.
 * Entities should be annotated with tags that hint at emotional weight.
 */
export function analyzeScene(entities: SceneEntityDescriptor[]): PacingCurve {
  if (entities.length === 0) {
    return buildCurve([
      { position: 0, intensity: 0, emotion: 'calm', label: 'Empty scene' },
      { position: 1, intensity: 0, emotion: 'calm', label: 'Empty scene' },
    ]);
  }

  // Bucket entities into 10 equal segments
  const BUCKETS = 10;
  const buckets: SceneEntityDescriptor[][] = Array.from(
    { length: BUCKETS },
    () => [],
  );

  for (const entity of entities) {
    const idx = Math.min(
      Math.floor(entity.position * BUCKETS),
      BUCKETS - 1,
    );
    buckets[idx].push(entity);
  }

  const points: PacingPoint[] = [];

  for (let i = 0; i < BUCKETS; i++) {
    const bucket = buckets[i];
    const position = i / (BUCKETS - 1);

    if (bucket.length === 0) {
      points.push({
        position,
        intensity: 0.1,
        emotion: 'calm',
        label: 'Quiet area',
      });
      continue;
    }

    // Aggregate tag emotions
    const emotionScores: Record<EmotionType, number> = {
      tension: 0,
      excitement: 0,
      calm: 0,
      fear: 0,
      wonder: 0,
    };

    for (const entity of bucket) {
      for (const tag of entity.tags) {
        const mapping = TAG_EMOTION_MAP[tag.toLowerCase()];
        if (mapping) {
          emotionScores[mapping.emotion] += mapping.weight;
        }
      }
    }

    // Pick dominant
    let bestEmotion: EmotionType = 'calm';
    let bestScore = -1;
    for (const [k, v] of Object.entries(emotionScores)) {
      if (v > bestScore) {
        bestScore = v;
        bestEmotion = k as EmotionType;
      }
    }

    const intensity = clamp(bestScore / Math.max(bucket.length, 1), 0, 1);
    const topEntity = bucket[0];

    points.push({
      position,
      intensity: Math.max(intensity, 0.05),
      emotion: bestEmotion,
      label: topEntity.name,
    });
  }

  return buildCurve(points);
}

// ---------------------------------------------------------------------------
// Curve Comparison
// ---------------------------------------------------------------------------

/**
 * Compare two pacing curves and return a similarity score (0–100).
 * Uses interpolated intensity difference at uniform sample points.
 */
export function compareCurves(a: PacingCurve, b: PacingCurve): number {
  const SAMPLES = 20;
  let totalDiff = 0;

  for (let i = 0; i <= SAMPLES; i++) {
    const t = i / SAMPLES;
    const va = interpolateIntensity(a, t);
    const vb = interpolateIntensity(b, t);
    totalDiff += Math.abs(va - vb);
  }

  const avgDiff = totalDiff / (SAMPLES + 1);
  // Convert average diff (0–1) to score (100–0)
  return Math.round(clamp((1 - avgDiff) * 100, 0, 100));
}

function interpolateIntensity(curve: PacingCurve, t: number): number {
  const pts = curve.points;
  if (pts.length === 0) return 0;
  if (pts.length === 1) return pts[0].intensity;
  if (t <= pts[0].position) return pts[0].intensity;
  if (t >= pts[pts.length - 1].position) return pts[pts.length - 1].intensity;

  for (let i = 0; i < pts.length - 1; i++) {
    if (t >= pts[i].position && t <= pts[i + 1].position) {
      const range = pts[i + 1].position - pts[i].position;
      if (range === 0) return pts[i].intensity;
      const frac = (t - pts[i].position) / range;
      return pts[i].intensity + frac * (pts[i + 1].intensity - pts[i].intensity);
    }
  }

  return pts[pts.length - 1].intensity;
}

// ---------------------------------------------------------------------------
// Issue Detection
// ---------------------------------------------------------------------------

function detectIssues(curve: PacingCurve): PacingIssue[] {
  const issues: PacingIssue[] = [];
  const pts = curve.points;

  // 1. Monotony detection — long stretches with near-identical intensity
  for (let i = 0; i < pts.length - 2; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const c = pts[i + 2];
    if (
      Math.abs(a.intensity - b.intensity) < 0.1 &&
      Math.abs(b.intensity - c.intensity) < 0.1
    ) {
      issues.push({
        severity: 'warning',
        position: b.position,
        message: 'Flat pacing detected — three consecutive points with similar intensity.',
        suggestion:
          'Add a contrasting beat (e.g., a rest after action, or a spike after calm) to create rhythm.',
      });
    }
  }

  // 2. No climax — intensity never exceeds 0.7
  const maxIntensity = Math.max(...pts.map((p) => p.intensity));
  if (maxIntensity < 0.7) {
    issues.push({
      severity: 'error',
      position: 0.9,
      message: 'No emotional climax — peak intensity is below 0.7.',
      suggestion:
        'Introduce a high-stakes moment near the 80-90% mark of the level.',
    });
  }

  // 3. Abrupt transitions — large intensity jumps between adjacent points
  for (let i = 0; i < pts.length - 1; i++) {
    const diff = Math.abs(pts[i + 1].intensity - pts[i].intensity);
    if (diff > 0.5) {
      issues.push({
        severity: 'info',
        position: pts[i + 1].position,
        message: `Abrupt intensity change (${diff.toFixed(2)}) between adjacent points.`,
        suggestion:
          'Consider adding a transitional beat to smooth the emotional shift.',
      });
    }
  }

  // 4. No rest — never drops below 0.3
  const minIntensity = Math.min(...pts.map((p) => p.intensity));
  if (minIntensity > 0.3 && pts.length > 3) {
    issues.push({
      severity: 'warning',
      position: 0.5,
      message: 'No rest beat — intensity never drops below 0.3.',
      suggestion:
        'Add a quiet moment (safe area, checkpoint, story beat) to prevent player fatigue.',
    });
  }

  return issues;
}

// ---------------------------------------------------------------------------
// Improvement Suggestions
// ---------------------------------------------------------------------------

function generateSuggestions(
  curve: PacingCurve,
  templateId?: PacingTemplateId,
): PacingSuggestion[] {
  const suggestions: PacingSuggestion[] = [];

  // Generic: opening hook
  if (curve.points.length > 1 && curve.points[0].intensity < 0.2) {
    suggestions.push({
      title: 'Strengthen the Opening Hook',
      description:
        'The level starts very quietly. Consider adding an early action beat or dramatic reveal to capture attention within the first 10%.',
      range: [0, 0.1],
      priority: 'medium',
    });
  }

  // Generic: ending resolution
  const lastPt = curve.points[curve.points.length - 1];
  if (lastPt && lastPt.intensity > 0.7) {
    suggestions.push({
      title: 'Add a Resolution Beat',
      description:
        'The level ends at high intensity. A cool-down moment gives players time to process the experience.',
      range: [0.9, 1.0],
      priority: 'medium',
    });
  }

  // Template-specific
  if (templateId) {
    const template = PACING_TEMPLATES[templateId];
    if (template) {
      const score = compareCurves(curve, template.curve);
      if (score < 60) {
        suggestions.push({
          title: `Low Match with "${template.name}" Template`,
          description: `Your pacing curve only matches ${score}% of the ${template.name} template. Review the template overlay for specific divergence points.`,
          range: [0, 1],
          priority: 'high',
        });
      }
    }
  }

  // Variance-based
  if (curve.variance < 0.02 && curve.points.length > 3) {
    suggestions.push({
      title: 'Increase Emotional Variety',
      description:
        'The pacing is very flat. Great games alternate between high and low intensity to create emotional contrast.',
      range: [0, 1],
      priority: 'high',
    });
  }

  return suggestions;
}

// ---------------------------------------------------------------------------
// Main Analysis Entry Point
// ---------------------------------------------------------------------------

/**
 * Run a full pacing analysis on a set of scene entities, optionally
 * comparing against a genre template.
 */
export function analyzePacing(
  entities: SceneEntityDescriptor[],
  templateId?: PacingTemplateId,
): PacingAnalysis {
  const curve = analyzeScene(entities);
  const issues = detectIssues(curve);
  const suggestions = generateSuggestions(curve, templateId);

  // Score: start at 100, deduct for issues
  let score = 100;
  for (const issue of issues) {
    if (issue.severity === 'error') score -= 20;
    else if (issue.severity === 'warning') score -= 10;
    else score -= 3;
  }

  // Bonus/penalty for template match
  if (templateId) {
    const template = PACING_TEMPLATES[templateId];
    if (template) {
      const matchScore = compareCurves(curve, template.curve);
      // Blend: 70% issue-based, 30% template-match
      score = Math.round(score * 0.7 + matchScore * 0.3);
    }
  }

  score = clamp(score, 0, 100);

  return {
    curve,
    issues,
    suggestions,
    score,
    comparedTemplate: templateId ?? null,
  };
}
