/**
 * Design Teacher — AI-powered game design education module.
 * Analyzes scenes and explains design principles, offering teachable moments
 * so creators learn game design while building.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DesignCategory =
  | 'mechanics'
  | 'level_design'
  | 'narrative'
  | 'balance'
  | 'ux'
  | 'aesthetics';

export interface DesignLesson {
  principle: string;
  category: DesignCategory;
  explanation: string;
  example: string;
  relevance: string;
}

export interface Alternative {
  description: string;
  pros: string[];
  cons: string[];
  whyNotChosen: string;
}

export interface DesignDecision {
  decision: string;
  reasoning: string[];
  principles: string[];
  alternatives: Alternative[];
  tradeoffs: string[];
}

export interface DesignCritiqueScore {
  principle: string;
  score: number; // 0-10
  feedback: string;
}

export interface DesignCritique {
  overallScore: number;
  summary: string;
  strengths: string[];
  improvements: string[];
  scores: DesignCritiqueScore[];
}

// ---------------------------------------------------------------------------
// Minimal scene context interface (decoupled from full EditorStore types)
// ---------------------------------------------------------------------------

export interface TeacherSceneEntity {
  name: string;
  entityType: string;
  components: string[];
  hasPhysics: boolean;
  hasScript: boolean;
  hasAudio: boolean;
  hasAnimation: boolean;
  hasGameComponent: boolean;
  gameComponentTypes: string[];
  position: [number, number, number];
}

export interface TeacherSceneContext {
  entityCount: number;
  entities: TeacherSceneEntity[];
  lightCount: number;
  hasShadows: boolean;
  hasPhysicsGround: boolean;
  hasDynamicBodies: boolean;
  hasPlayerCharacter: boolean;
  hasCollectibles: boolean;
  hasEnemies: boolean;
  hasWinCondition: boolean;
  hasUI: boolean;
  hasDialogue: boolean;
  projectType: '2d' | '3d';
}

// ---------------------------------------------------------------------------
// Design Principles Catalog
// ---------------------------------------------------------------------------

export interface DesignPrinciple {
  id: string;
  name: string;
  category: DesignCategory;
  description: string;
  example: string;
  keywords: string[];
}

export const DESIGN_PRINCIPLES: DesignPrinciple[] = [
  {
    id: 'flow-theory',
    name: 'Flow Theory',
    category: 'balance',
    description:
      'Mihaly Csikszentmihalyi\'s concept: players enter "flow" when challenge matches skill level. Too easy causes boredom; too hard causes frustration.',
    example:
      'Gradually increase enemy speed and count as the player progresses through levels.',
    keywords: ['difficulty', 'challenge', 'skill', 'progression', 'curve'],
  },
  {
    id: 'progressive-disclosure',
    name: 'Progressive Disclosure',
    category: 'ux',
    description:
      'Introduce mechanics one at a time so players learn incrementally rather than being overwhelmed.',
    example:
      'Level 1 teaches movement. Level 2 introduces jumping. Level 3 adds enemies.',
    keywords: ['tutorial', 'learning', 'introduce', 'teach', 'onboarding'],
  },
  {
    id: 'juice-feedback',
    name: 'Juice / Game Feel',
    category: 'aesthetics',
    description:
      'Extra visual and audio feedback that makes interactions feel satisfying — screen shake, particles, sounds, animations on every action.',
    example:
      'When a player collects a coin: play a chime, spawn sparkle particles, briefly scale the coin up, and flash the score counter.',
    keywords: ['particles', 'audio', 'animation', 'feedback', 'feel', 'polish'],
  },
  {
    id: 'risk-reward',
    name: 'Risk vs Reward',
    category: 'mechanics',
    description:
      'Give players meaningful choices where higher risk yields greater rewards, creating tension and strategic depth.',
    example:
      'A narrow shortcut through a lava zone saves 10 seconds but has lethal hazards. The safe route is slower but guaranteed.',
    keywords: ['risk', 'reward', 'choice', 'danger', 'shortcut', 'tradeoff'],
  },
  {
    id: 'convexity',
    name: 'Convexity',
    category: 'mechanics',
    description:
      'Options that create more options are "convex." Good game design favors convex choices that expand possibilities rather than narrowing them.',
    example:
      'A key that opens multiple doors is convex; a consumable that gets used up once is concave.',
    keywords: ['options', 'choices', 'possibilities', 'expand', 'strategy'],
  },
  {
    id: 'emergence',
    name: 'Emergence',
    category: 'mechanics',
    description:
      'Complex behaviors arising from simple rules interacting. A few simple mechanics can create endless possibilities when they combine.',
    example:
      'Physics + fire + wind = fire can spread to wooden objects and be blown by wind gusts, creating emergent gameplay.',
    keywords: ['combine', 'interact', 'simple', 'complex', 'systemic', 'emergent'],
  },
  {
    id: 'weenie',
    name: 'Visual Weenie (Landmark)',
    category: 'level_design',
    description:
      'A visually prominent landmark that draws the player\'s eye and guides navigation without explicit waypoints. Disney Imagineering term.',
    example:
      'A glowing tower visible from anywhere in the level tells players where to go without a minimap.',
    keywords: ['landmark', 'navigation', 'guide', 'visible', 'tower', 'beacon'],
  },
  {
    id: 'affordance',
    name: 'Affordance',
    category: 'ux',
    description:
      'Objects should visually communicate how they can be interacted with. A ledge that looks climbable should be climbable.',
    example:
      'Climbable walls have visible handholds with a different material color than non-climbable surfaces.',
    keywords: ['interact', 'visual', 'communicate', 'climbable', 'pushable', 'hint'],
  },
  {
    id: 'three-act-structure',
    name: 'Three-Act Structure',
    category: 'narrative',
    description:
      'Setup, confrontation, resolution. Even non-narrative games benefit from rising tension, climax, and denouement.',
    example:
      'Act 1: explore a peaceful village. Act 2: the village is attacked. Act 3: defeat the boss and restore peace.',
    keywords: ['story', 'narrative', 'act', 'climax', 'tension', 'resolution'],
  },
  {
    id: 'rule-of-three',
    name: 'Rule of Three',
    category: 'level_design',
    description:
      'Introduce a mechanic in a safe context, test it with moderate challenge, then present a mastery challenge. Three encounters cement understanding.',
    example:
      'First spike pit is narrow with a safe platform nearby. Second is wider. Third combines spikes with a moving platform.',
    keywords: ['three', 'repeat', 'mastery', 'teach', 'variation'],
  },
  {
    id: 'negative-space',
    name: 'Negative Space',
    category: 'aesthetics',
    description:
      'Empty areas give the eye (and player) rest. Not every space needs content. Breathing room between challenges prevents fatigue.',
    example:
      'A calm meadow between two combat arenas lets players recover and appreciate the environment.',
    keywords: ['empty', 'space', 'rest', 'breathing', 'calm', 'sparse'],
  },
  {
    id: 'feedback-loop',
    name: 'Feedback Loops',
    category: 'mechanics',
    description:
      'Positive loops (success breeds more success) create excitement. Negative loops (rubber-banding) keep games competitive. Balance both.',
    example:
      'Mario Kart uses negative feedback: players in last place get better power-ups to stay competitive.',
    keywords: ['loop', 'positive', 'negative', 'rubber-band', 'snowball', 'catch-up'],
  },
  {
    id: 'color-theory',
    name: 'Color Theory',
    category: 'aesthetics',
    description:
      'Colors communicate mood, guide attention, and convey information. Warm colors feel energetic; cool colors feel calm. Contrast highlights importance.',
    example:
      'Collectible items use bright gold against a muted blue environment so they stand out immediately.',
    keywords: ['color', 'palette', 'contrast', 'warm', 'cool', 'mood'],
  },
  {
    id: 'camera-composition',
    name: 'Camera Composition',
    category: 'aesthetics',
    description:
      'Camera placement and movement shape how players perceive the world. Follow the rule of thirds, lead the eye, and match camera to genre.',
    example:
      'A side-scroller positions the camera slightly ahead of the player in the direction of movement.',
    keywords: ['camera', 'composition', 'angle', 'follow', 'perspective'],
  },
  {
    id: 'economy-design',
    name: 'Economy Design',
    category: 'balance',
    description:
      'In-game currencies, item costs, and reward amounts must be balanced so progression feels earned but not grindy.',
    example:
      'A common enemy drops 5 coins. The first upgrade costs 50 coins (10 enemies). Later upgrades scale quadratically.',
    keywords: ['currency', 'economy', 'cost', 'reward', 'grind', 'loot'],
  },
  {
    id: 'signposting',
    name: 'Signposting',
    category: 'level_design',
    description:
      'Subtle environmental cues that guide the player without breaking immersion. Lighting, color, and geometry all serve as signs.',
    example:
      'A warm light at the end of a dark corridor draws the player forward naturally.',
    keywords: ['guide', 'path', 'direction', 'light', 'cue', 'hint'],
  },
  {
    id: 'spatial-audio',
    name: 'Spatial Audio Cues',
    category: 'ux',
    description:
      'Sound positioned in 3D space helps players locate objects, enemies, and events without looking at them.',
    example:
      'A ticking bomb emits 3D audio that gets louder as the player approaches, creating tension and guiding search.',
    keywords: ['audio', 'sound', 'spatial', '3d', 'direction', 'locate'],
  },
  {
    id: 'difficulty-curves',
    name: 'Difficulty Curves',
    category: 'balance',
    description:
      'Difficulty should generally increase over time but with periodic "valleys" where players can recover and feel powerful.',
    example:
      'After a hard boss fight, the next area has weaker enemies so the player feels strong before the next spike.',
    keywords: ['difficulty', 'curve', 'spike', 'valley', 'boss', 'pacing'],
  },
  {
    id: 'player-agency',
    name: 'Player Agency',
    category: 'mechanics',
    description:
      'Players should feel their choices matter. Outcomes should feel like consequences of player decisions, not random or predetermined.',
    example:
      'When a player chooses to spare an NPC, that NPC shows up later to help — the choice had a real impact.',
    keywords: ['choice', 'agency', 'consequence', 'decision', 'impact', 'meaningful'],
  },
  {
    id: 'constraint-creativity',
    name: 'Constraints Drive Creativity',
    category: 'mechanics',
    description:
      'Limitations force creative solutions. A game with fewer mechanics but deep interactions is often better than one with many shallow ones.',
    example:
      'Portal has only two mechanics (portals + physics) but creates hundreds of unique puzzles from their interaction.',
    keywords: ['constraint', 'limit', 'simple', 'deep', 'creative', 'mechanic'],
  },
  {
    id: 'safe-space-experiment',
    name: 'Safe Experimentation Space',
    category: 'ux',
    description:
      'Give players a low-stakes area to experiment with new mechanics before stakes are raised. Failure should be cheap early on.',
    example:
      'A tutorial room lets players practice wall-jumping over a short gap with no penalty for falling.',
    keywords: ['safe', 'practice', 'experiment', 'tutorial', 'penalty', 'forgiving'],
  },
  {
    id: 'visual-hierarchy',
    name: 'Visual Hierarchy',
    category: 'aesthetics',
    description:
      'Important elements should be the most visually prominent. Size, contrast, color, and animation establish what matters most.',
    example:
      'The health bar is large and red at the top of screen. Ammo count is smaller and white. Score is smallest.',
    keywords: ['hierarchy', 'importance', 'size', 'contrast', 'prominent', 'ui'],
  },
  {
    id: 'pacing',
    name: 'Pacing',
    category: 'level_design',
    description:
      'Alternate between high-intensity and low-intensity moments. Constant action causes fatigue; constant calm causes boredom.',
    example:
      'Combat encounter -> exploration -> puzzle -> combat encounter. Each section is a different tempo.',
    keywords: ['pacing', 'rhythm', 'tempo', 'alternate', 'intensity', 'rest'],
  },
  {
    id: 'kissing-principle',
    name: 'KISS (Keep It Simple)',
    category: 'mechanics',
    description:
      'Start with the simplest version of a mechanic that is fun. Add complexity only when the simple version is proven to work.',
    example:
      'Start with basic left/right movement and a jump. Only add double-jump, wall-slide, or dash after the core feels great.',
    keywords: ['simple', 'minimal', 'core', 'start', 'basic', 'iterate'],
  },
];

// ---------------------------------------------------------------------------
// Suggestion Engine — identifies teachable moments from scene state
// ---------------------------------------------------------------------------

/**
 * Analyze the current scene and identify design lessons relevant to what the
 * creator is building right now.
 */
export function suggestLessons(ctx: TeacherSceneContext): DesignLesson[] {
  const lessons: DesignLesson[] = [];

  // Empty scene — start with basics
  if (ctx.entityCount === 0) {
    lessons.push({
      principle: 'KISS (Keep It Simple)',
      category: 'mechanics',
      explanation:
        'Start with the simplest possible version of your game. Add one entity at a time and make sure each addition serves a purpose.',
      example:
        'Begin with a ground plane and a player character. Get movement feeling right before adding anything else.',
      relevance: 'Your scene is empty — this is the perfect time to start simple and intentional.',
    });
    return lessons;
  }

  // Has player but no enemies/collectibles
  if (ctx.hasPlayerCharacter && !ctx.hasCollectibles && !ctx.hasEnemies) {
    lessons.push({
      principle: 'Progressive Disclosure',
      category: 'ux',
      explanation:
        'You have a player character — great start! Now introduce one new element at a time. A single collectible or a single obstacle teaches the player what to expect.',
      example:
        'Add 3 collectible coins along a straightforward path so players learn the "collect" mechanic before any challenge.',
      relevance:
        'Your scene has a player but no interactive objects. Adding one simple interaction will make it feel like a game.',
    });
  }

  // Has collectibles but no win condition
  if (ctx.hasCollectibles && !ctx.hasWinCondition) {
    lessons.push({
      principle: 'Player Agency',
      category: 'mechanics',
      explanation:
        'Collectibles are great, but players need a goal. A win condition gives meaning to the collecting — otherwise, why bother?',
      example:
        'Add a win condition: "collect all 5 stars to complete the level." Now each star matters.',
      relevance:
        'You have collectible entities but no win condition. Adding one will give players a clear objective.',
    });
  }

  // Has dynamic physics but no ground
  if (ctx.hasDynamicBodies && !ctx.hasPhysicsGround) {
    lessons.push({
      principle: 'Safe Experimentation Space',
      category: 'ux',
      explanation:
        'Dynamic physics objects need something to land on. Without a ground plane, everything falls into the void — players cannot experiment safely.',
      example:
        'Add a large ground plane with a fixed physics body so objects have a surface to interact with.',
      relevance:
        'You have dynamic bodies but no fixed ground. Objects will fall indefinitely during play mode.',
    });
  }

  // Multiple entities but no audio
  if (ctx.entityCount > 3 && !ctx.entities.some((e) => e.hasAudio)) {
    lessons.push({
      principle: 'Juice / Game Feel',
      category: 'aesthetics',
      explanation:
        'Sound is half the experience. Even simple ambient audio or sound effects dramatically improve how "alive" a game feels.',
      example:
        'Add a background music loop and a sound effect for when the player collects an item.',
      relevance:
        'Your scene has several entities but no audio. Adding sounds will significantly improve the feel.',
    });
  }

  // Has player + enemies but no health system
  if (
    ctx.hasPlayerCharacter &&
    ctx.hasEnemies &&
    !ctx.entities.some((e) => e.gameComponentTypes.includes('health'))
  ) {
    lessons.push({
      principle: 'Risk vs Reward',
      category: 'mechanics',
      explanation:
        'Enemies create danger, but without a health system there are no consequences. Risk/reward requires that danger has teeth.',
      example:
        'Add a Health component to the player with 3 hit points. Each enemy contact removes one. Now enemies matter.',
      relevance:
        'You have a player and enemies but no health system. Adding health creates real stakes.',
    });
  }

  // No lighting consideration
  if (ctx.lightCount === 0 && ctx.entityCount > 0) {
    lessons.push({
      principle: 'Color Theory',
      category: 'aesthetics',
      explanation:
        'Lighting sets the mood of your entire scene. Without deliberate lighting, everything looks flat and lifeless.',
      example:
        'A warm directional light creates a sunset feel. A cool blue ambient light creates a mysterious mood.',
      relevance:
        'Your scene has no lights. Adding a directional light will immediately improve the visual quality.',
    });
  }

  // Has shadows
  if (ctx.hasShadows) {
    lessons.push({
      principle: 'Visual Hierarchy',
      category: 'aesthetics',
      explanation:
        'Shadows ground objects in the scene and create depth perception. They help players understand spatial relationships.',
      example:
        'A floating platform with a shadow on the ground below helps players judge the jump distance.',
      relevance:
        'Good choice enabling shadows — they add depth and readability to your scene.',
    });
  }

  // Large scene — pacing advice
  if (ctx.entityCount > 15) {
    lessons.push({
      principle: 'Pacing',
      category: 'level_design',
      explanation:
        'Your scene is growing! Make sure you alternate between high-intensity and low-intensity areas. Constant challenge causes fatigue.',
      example:
        'After a section with 3 enemies, place a safe platform with a collectible before the next challenge.',
      relevance: `With ${ctx.entityCount} entities, consider the rhythm of your level layout.`,
    });
  }

  // Has game components but no script
  if (
    ctx.entities.some((e) => e.hasGameComponent) &&
    !ctx.entities.some((e) => e.hasScript)
  ) {
    lessons.push({
      principle: 'Emergence',
      category: 'mechanics',
      explanation:
        'Game components provide pre-built behaviors, but scripts let you create unique interactions. The combination of simple systems creates emergent gameplay.',
      example:
        'A script that makes collectibles respawn after 10 seconds adds a time-pressure mechanic on top of the built-in collector.',
      relevance:
        'You have game components but no scripts yet. Scripts can add unique twists to pre-built behaviors.',
    });
  }

  // Rule of three — few entities of same type
  const meshEntities = ctx.entities.filter((e) => e.entityType === 'mesh');
  if (meshEntities.length >= 2 && meshEntities.length <= 5) {
    lessons.push({
      principle: 'Rule of Three',
      category: 'level_design',
      explanation:
        'When introducing a challenge, use three encounters: safe introduction, moderate test, mastery challenge. This teaches players naturally.',
      example:
        'First gap is small (easy jump). Second gap has a moving platform (moderate). Third gap requires precise timing (mastery).',
      relevance:
        'You have a few mesh objects — consider arranging them as a three-part learning sequence.',
    });
  }

  // 2D specific
  if (ctx.projectType === '2d' && ctx.entityCount > 5) {
    lessons.push({
      principle: 'Camera Composition',
      category: 'aesthetics',
      explanation:
        'In 2D games, what the player sees at any moment defines the experience. Make sure the camera reveals what matters and hides what does not.',
      example:
        'Position the camera so the player character is in the left third of the screen, giving more view of upcoming obstacles.',
      relevance:
        'Your 2D scene has several entities — consider how the camera frames the action.',
    });
  }

  return lessons;
}

// ---------------------------------------------------------------------------
// Decision Explanation — async because it could call AI in the future
// ---------------------------------------------------------------------------

/**
 * Explain a design decision in context of the current scene.
 * Currently uses rule-based analysis; designed to accept AI augmentation later.
 */
export function explainDecision(
  decision: string,
  ctx: TeacherSceneContext,
): DesignDecision {
  const lowerDecision = decision.toLowerCase();
  const principles: string[] = [];
  const reasoning: string[] = [];
  const alternatives: Alternative[] = [];
  const tradeoffs: string[] = [];

  // Match relevant principles by keyword
  for (const principle of DESIGN_PRINCIPLES) {
    const matches = principle.keywords.some((kw) => lowerDecision.includes(kw));
    if (matches) {
      principles.push(principle.name);
    }
  }

  // Generic reasoning based on scene state
  if (ctx.entityCount === 0) {
    reasoning.push(
      'Starting from an empty scene means every addition is a foundation piece.',
    );
  }

  if (ctx.hasPlayerCharacter) {
    reasoning.push(
      'With a player character present, decisions should consider how they affect player experience.',
    );
  }

  if (lowerDecision.includes('enemy') || lowerDecision.includes('hazard')) {
    reasoning.push(
      'Adding danger creates tension and makes the game feel more engaging through risk/reward dynamics.',
    );
    principles.push('Risk vs Reward');
    alternatives.push({
      description: 'Use environmental hazards instead of enemies',
      pros: ['Simpler AI needed', 'Consistent behavior', 'Easier to balance'],
      cons: ['Less dynamic', 'No pursuit/evasion gameplay'],
      whyNotChosen:
        'Active enemies create more dynamic and replayable encounters.',
    });
    tradeoffs.push(
      'More enemies increase challenge but also increase the chance of frustration for new players.',
    );
  }

  if (lowerDecision.includes('collect') || lowerDecision.includes('pickup')) {
    reasoning.push(
      'Collectibles provide positive feedback and encourage exploration.',
    );
    principles.push('Juice / Game Feel');
    alternatives.push({
      description: 'Use score points instead of physical collectibles',
      pros: ['No entity management', 'Simple implementation'],
      cons: ['Less tangible reward', 'No exploration incentive'],
      whyNotChosen:
        'Physical collectibles in the world encourage exploration and feel more rewarding.',
    });
    tradeoffs.push(
      'Too many collectibles can feel like busywork; too few can feel sparse.',
    );
  }

  if (lowerDecision.includes('light') || lowerDecision.includes('shadow')) {
    reasoning.push(
      'Lighting shapes mood, guides the player, and adds visual depth.',
    );
    principles.push('Signposting');
    principles.push('Color Theory');
    tradeoffs.push(
      'More shadow-casting lights improve visuals but impact performance.',
    );
  }

  if (lowerDecision.includes('platform') || lowerDecision.includes('jump')) {
    reasoning.push(
      'Platforming mechanics test timing and spatial awareness.',
    );
    principles.push('Flow Theory');
    alternatives.push({
      description: 'Use ramps instead of platforms for smoother traversal',
      pros: ['More accessible', 'Feels smoother'],
      cons: ['Less challenge', 'Less satisfying mastery'],
      whyNotChosen:
        'Platforms offer discrete challenges that feel satisfying to master.',
    });
    tradeoffs.push(
      'Platform spacing affects difficulty: too far is frustrating, too close is trivial.',
    );
  }

  if (lowerDecision.includes('physics')) {
    reasoning.push(
      'Physics adds realism and creates opportunities for emergent gameplay.',
    );
    principles.push('Emergence');
    tradeoffs.push(
      'Realistic physics can be unpredictable. Consider tuning gravity and friction for game feel over realism.',
    );
  }

  // Ensure at least basic output
  if (principles.length === 0) {
    principles.push('KISS (Keep It Simple)');
  }
  if (reasoning.length === 0) {
    reasoning.push(
      'Every design decision should serve the player experience.',
    );
  }

  // Deduplicate principles
  const uniquePrinciples = [...new Set(principles)];

  return {
    decision,
    reasoning,
    principles: uniquePrinciples,
    alternatives,
    tradeoffs,
  };
}

// ---------------------------------------------------------------------------
// Design Critique — analyzes the overall scene against principles
// ---------------------------------------------------------------------------

/**
 * Generate a design critique of the current scene state.
 * Scores each relevant principle and provides actionable feedback.
 */
export function generateDesignCritique(
  ctx: TeacherSceneContext,
): DesignCritique {
  const scores: DesignCritiqueScore[] = [];
  const strengths: string[] = [];
  const improvements: string[] = [];

  // Evaluate core principles against scene state

  // 1. KISS
  if (ctx.entityCount <= 10 && ctx.entityCount > 0) {
    scores.push({
      principle: 'KISS',
      score: 8,
      feedback: 'Good restraint! A focused scene with few entities is easier to polish.',
    });
    strengths.push('Scene is focused and manageable.');
  } else if (ctx.entityCount > 30) {
    scores.push({
      principle: 'KISS',
      score: 4,
      feedback: `${ctx.entityCount} entities is a lot. Make sure each one serves a clear purpose.`,
    });
    improvements.push('Consider whether every entity is necessary.');
  } else if (ctx.entityCount === 0) {
    scores.push({
      principle: 'KISS',
      score: 5,
      feedback: 'An empty scene is simple, but you need at least a few entities to evaluate!',
    });
  } else {
    scores.push({
      principle: 'KISS',
      score: 6,
      feedback: 'Moderate complexity. Review each entity to ensure it earns its place.',
    });
  }

  // 2. Game Feel / Juice
  const hasAudio = ctx.entities.some((e) => e.hasAudio);
  const hasAnimation = ctx.entities.some((e) => e.hasAnimation);
  const hasParticles = ctx.entities.some((e) => e.components.includes('ParticleEnabled'));
  let juiceScore = 3;
  if (hasAudio) juiceScore += 2;
  if (hasAnimation) juiceScore += 2;
  if (hasParticles) juiceScore += 2;
  if (ctx.hasShadows) juiceScore += 1;
  juiceScore = Math.min(juiceScore, 10);
  scores.push({
    principle: 'Juice / Game Feel',
    score: juiceScore,
    feedback: juiceScore >= 7
      ? 'Great polish level! Audio, animation, and effects all contribute to game feel.'
      : 'Add more feedback: sound effects, animations, particles, and shadows make interactions feel satisfying.',
  });
  if (juiceScore >= 7) {
    strengths.push('Scene has good audio/visual feedback (juice).');
  } else {
    improvements.push('Add audio, particles, or animations for better game feel.');
  }

  // 3. Gameplay Loop
  let gameplayScore = 2;
  if (ctx.hasPlayerCharacter) gameplayScore += 2;
  if (ctx.hasCollectibles || ctx.hasEnemies) gameplayScore += 2;
  if (ctx.hasWinCondition) gameplayScore += 2;
  if (ctx.hasDynamicBodies) gameplayScore += 1;
  if (ctx.hasDialogue) gameplayScore += 1;
  gameplayScore = Math.min(gameplayScore, 10);
  scores.push({
    principle: 'Gameplay Loop',
    score: gameplayScore,
    feedback: gameplayScore >= 7
      ? 'Your scene has the elements of a complete gameplay loop: player, challenges, and objectives.'
      : 'A complete loop needs: a player, something to do, and a goal. Which piece is missing?',
  });
  if (gameplayScore >= 7) {
    strengths.push('Complete gameplay loop with player, challenges, and objectives.');
  } else {
    improvements.push('Build a complete gameplay loop: player + challenges + win condition.');
  }

  // 4. Visual Design
  let visualScore = 3;
  if (ctx.lightCount > 0) visualScore += 2;
  if (ctx.hasShadows) visualScore += 2;
  if (ctx.lightCount > 1) visualScore += 1;
  if (ctx.entityCount > 0) visualScore += 1;
  visualScore = Math.min(visualScore, 10);
  scores.push({
    principle: 'Visual Design',
    score: visualScore,
    feedback: visualScore >= 7
      ? 'Good lighting setup! Multiple light sources and shadows create visual depth.'
      : 'Improve your scene lighting. Add directional and fill lights with shadows for depth.',
  });
  if (visualScore >= 7) {
    strengths.push('Scene has thoughtful lighting with shadows.');
  } else if (ctx.entityCount > 0) {
    improvements.push('Add proper lighting with shadows for visual depth.');
  }

  // 5. Level Design
  if (ctx.entityCount >= 5) {
    let xMin = Infinity, xMax = -Infinity, zMin = Infinity, zMax = -Infinity;
    for (const e of ctx.entities) {
      const [x, , z] = e.position;
      if (x < xMin) xMin = x;
      if (x > xMax) xMax = x;
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
    const xRange = xMax - xMin;
    const zRange = zMax - zMin;
    const spread = Math.max(xRange, zRange);
    const levelScore = spread > 20 ? 7 : spread > 10 ? 6 : spread > 5 ? 5 : 4;
    scores.push({
      principle: 'Level Layout',
      score: levelScore,
      feedback: levelScore >= 6
        ? 'Entities are well-distributed across the space, creating room for exploration.'
        : 'Entities are clustered tightly. Spread them out to create a sense of space and flow.',
    });
    if (levelScore >= 6) {
      strengths.push('Good spatial distribution of entities.');
    } else {
      improvements.push('Spread entities out more to create exploration space.');
    }
  }

  // Calculate overall score
  const overallScore = scores.length > 0
    ? Math.round(scores.reduce((sum, s) => sum + s.score, 0) / scores.length * 10) / 10
    : 0;

  // Generate summary
  let summary: string;
  if (ctx.entityCount === 0) {
    summary = 'Your scene is empty. Start by adding a ground plane and a player character to build your first gameplay loop.';
  } else if (overallScore >= 7) {
    summary = 'Strong foundation! Your scene demonstrates good design fundamentals. Focus on polishing the details.';
  } else if (overallScore >= 5) {
    summary = 'Decent start with room for improvement. The core elements are there but could use more polish and completeness.';
  } else {
    summary = 'Early stage — focus on building a complete gameplay loop before adding complexity. Player + challenge + goal.';
  }

  return {
    overallScore,
    summary,
    strengths,
    improvements,
    scores,
  };
}

// ---------------------------------------------------------------------------
// Search / Filter
// ---------------------------------------------------------------------------

/**
 * Search design principles by query string.
 */
export function searchPrinciples(query: string): DesignPrinciple[] {
  if (!query.trim()) return DESIGN_PRINCIPLES;
  const lower = query.toLowerCase();
  return DESIGN_PRINCIPLES.filter(
    (p) =>
      p.name.toLowerCase().includes(lower) ||
      p.category.includes(lower) ||
      p.description.toLowerCase().includes(lower) ||
      p.keywords.some((kw) => kw.includes(lower)),
  );
}

/**
 * Get all principles for a given category.
 */
export function getPrinciplesByCategory(
  category: DesignCategory,
): DesignPrinciple[] {
  return DESIGN_PRINCIPLES.filter((p) => p.category === category);
}
