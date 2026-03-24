/**
 * Idea generator MCP command handlers.
 *
 * Provides 4 commands:
 *   generate_game_ideas  — produce N structured game ideas based on filters
 *   get_idea_details     — expand a brief idea into a GDD outline
 *   start_from_idea      — scaffold a project from a GameIdea (via create_scene compound)
 *   remix_idea           — mutate one dimension of an existing idea
 */

import { z } from 'zod';
import type { ToolHandler, ExecutionResult } from './types';
import { parseArgs } from './types';
import {
  generateIdeas,
  generateIdea,
  buildGddPrompt,
  GENRE_CATALOG,
  MECHANIC_CATALOG,
  type GameIdea,
  type IdeaFilters,
} from '@/lib/ai/ideaGenerator';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Map template names from spec to the 5 built-in game templates. */
function resolveTemplate(genres: string[]): string {
  const genreSet = new Set(genres);
  if (genreSet.has('platformer') || genreSet.has('metroidvania')) return 'platformer';
  if (genreSet.has('shooter')) return 'shooter';
  if (genreSet.has('puzzle')) return 'puzzle';
  if (genreSet.has('rpg') || genreSet.has('roguelike') || genreSet.has('card-game')) return 'explorer';
  if (genreSet.has('racing') || genreSet.has('survival')) return 'runner';
  return 'platformer'; // sensible default
}

/** Determine project dimensionality from genre tags. */
function resolve2dOr3d(idea: GameIdea): '2d' | '3d' {
  const tags2d = ['2d', 'pixel-art', 'sprite'];
  const allTags = [
    ...idea.genreMix.primary.tags,
    ...idea.genreMix.secondary.tags,
  ];
  return allTags.some((t) => tags2d.includes(t)) ? '2d' : '3d';
}

// ---------------------------------------------------------------------------
// Handler registry
// ---------------------------------------------------------------------------

export const ideaHandlers: Record<string, ToolHandler> = {
  generate_game_ideas: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(
      z.object({
        count: z.number().int().min(1).max(5).optional(),
        genreIds: z.array(z.string()).optional(),
        mechanicIds: z.array(z.string()).optional(),
        maxComplexity: z.enum(['low', 'medium', 'high']).optional(),
        trendingOnly: z.boolean().optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const count = p.data.count ?? 3;
    const filters: IdeaFilters = {
      genreIds: p.data.genreIds,
      mechanicIds: p.data.mechanicIds,
      maxComplexity: p.data.maxComplexity,
      trendingOnly: p.data.trendingOnly,
    };

    const ideas = generateIdeas(count, filters);

    return {
      success: true,
      message: `Generated ${ideas.length} game idea${ideas.length === 1 ? '' : 's'}.`,
      result: {
        ideas: ideas.map((idea) => ({
          id: idea.id,
          title: idea.title,
          description: idea.description,
          primaryGenre: idea.genreMix.primary.name,
          secondaryGenre: idea.genreMix.secondary.name,
          mechanics: idea.mechanicCombo.mechanics.map((m) => m.name),
          score: idea.score,
          hooks: idea.hooks,
          targetAudience: idea.targetAudience,
          templateMatch: resolveTemplate([
            idea.genreMix.primary.id,
            idea.genreMix.secondary.id,
          ]),
        })),
      },
    };
  },

  get_idea_details: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(
      z.object({
        ideaId: z.string().min(1).optional(),
        primaryGenre: z.string().min(1).optional(),
        secondaryGenre: z.string().min(1).optional(),
        mechanics: z.array(z.string()).optional(),
        title: z.string().optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    // Reconstruct an idea from provided fields or generate a fresh one
    let idea: GameIdea;

    if (p.data.primaryGenre) {
      const primaryGenre =
        GENRE_CATALOG.find((g) => g.id === p.data.primaryGenre || g.name.toLowerCase() === p.data.primaryGenre?.toLowerCase()) ??
        GENRE_CATALOG[0];
      const secondaryGenre =
        GENRE_CATALOG.find((g) => g.id === p.data.secondaryGenre || g.name.toLowerCase() === p.data.secondaryGenre?.toLowerCase()) ??
        GENRE_CATALOG[1];

      const mechanicList = (p.data.mechanics ?? [])
        .map((m) => MECHANIC_CATALOG.find((mc) => mc.id === m || mc.name.toLowerCase() === m.toLowerCase()))
        .filter((m) => m !== undefined);

      const selectedMechanics = mechanicList.length > 0
        ? mechanicList
        : [MECHANIC_CATALOG[0], MECHANIC_CATALOG[1]];

      idea = generateIdea({
        genreIds: [primaryGenre.id, secondaryGenre.id],
      });
      // Overlay the requested title if provided
      if (p.data.title) {
        idea = { ...idea, title: p.data.title };
      }
    } else {
      idea = generateIdea({});
    }

    const gddPrompt = buildGddPrompt(idea);

    return {
      success: true,
      message: `GDD outline for "${idea.title}" ready.`,
      result: {
        title: idea.title,
        gddOutlinePrompt: gddPrompt,
        idea: {
          primaryGenre: idea.genreMix.primary.name,
          secondaryGenre: idea.genreMix.secondary.name,
          mechanics: idea.mechanicCombo.mechanics.map((m) => ({
            name: m.name,
            description: m.description,
            complexity: m.complexity,
          })),
          targetAudience: idea.targetAudience,
          hooks: idea.hooks,
          score: idea.score,
        },
      },
    };
  },

  start_from_idea: async (args, ctx): Promise<ExecutionResult> => {
    const p = parseArgs(
      z.object({
        title: z.string().min(1),
        primaryGenre: z.string().min(1),
        secondaryGenre: z.string().min(1),
        mechanics: z.array(z.string()).optional(),
        templateMatch: z.string().optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    // Reconstruct a minimal idea to resolve template / dimensionality
    const primaryGenre =
      GENRE_CATALOG.find((g) => g.id === p.data.primaryGenre || g.name.toLowerCase() === p.data.primaryGenre.toLowerCase()) ??
      GENRE_CATALOG[0];
    const secondaryGenre =
      GENRE_CATALOG.find((g) => g.id === p.data.secondaryGenre || g.name.toLowerCase() === p.data.secondaryGenre.toLowerCase()) ??
      GENRE_CATALOG[1];

    const idea: GameIdea = generateIdea({
      genreIds: [primaryGenre.id, secondaryGenre.id],
    });
    idea.title = p.data.title;

    const templateName = p.data.templateMatch ?? resolveTemplate([primaryGenre.id, secondaryGenre.id]);
    const projectType = resolve2dOr3d(idea);
    const sceneName = `${p.data.title} - Main`;

    // Reuse existing create_scene compound action to scaffold the project
    const { compoundHandlers } = await import('./compoundHandlers');
    const createSceneHandler = compoundHandlers['create_scene'];

    const sceneResult = createSceneHandler
      ? await createSceneHandler(
          {
            name: sceneName,
            description: `Game scene for ${p.data.title}: a ${primaryGenre.name}/${secondaryGenre.name} game.`,
            entities: [],
          },
          ctx,
        )
      : { success: true as const, result: { message: 'Scene creation skipped — handler not found.' } };

    return {
      success: true,
      message: `Project scaffolded for "${p.data.title}" using the ${templateName} template (${projectType}).`,
      result: {
        title: p.data.title,
        templateUsed: templateName,
        projectType,
        sceneName,
        primaryGenre: primaryGenre.name,
        secondaryGenre: secondaryGenre.name,
        mechanics: (p.data.mechanics ?? idea.mechanicCombo.mechanics.map((m) => m.name)),
        sceneCreation: sceneResult,
      },
    };
  },

  remix_idea: async (args, _ctx): Promise<ExecutionResult> => {
    const p = parseArgs(
      z.object({
        primaryGenre: z.string().min(1),
        secondaryGenre: z.string().min(1),
        mechanics: z.array(z.string()).optional(),
        dimension: z.enum(['genre', 'mechanic', 'both']).optional(),
      }),
      args,
    );
    if (p.error) return p.error;

    const dimension = p.data.dimension ?? 'mechanic';

    let newGenreIds = [p.data.primaryGenre, p.data.secondaryGenre];
    let newMechanicIds = p.data.mechanics ?? [];

    if (dimension === 'genre' || dimension === 'both') {
      // Swap the secondary genre for a random different one
      const currentIds = new Set([p.data.primaryGenre, p.data.secondaryGenre]);
      const alternatives = GENRE_CATALOG.filter((g) => !currentIds.has(g.id));
      if (alternatives.length > 0) {
        const pick = alternatives[Math.floor(Math.random() * alternatives.length)];
        newGenreIds = [p.data.primaryGenre, pick.id];
      }
    }

    if (dimension === 'mechanic' || dimension === 'both') {
      // Swap one mechanic for a random different one
      const currentMechanicIds = new Set(newMechanicIds);
      const alternatives = MECHANIC_CATALOG.filter((m) => !currentMechanicIds.has(m.id));
      if (alternatives.length > 0) {
        const pick = alternatives[Math.floor(Math.random() * alternatives.length)];
        const updated = [...newMechanicIds];
        if (updated.length > 0) {
          updated[updated.length - 1] = pick.id;
        } else {
          updated.push(pick.id);
        }
        newMechanicIds = updated;
      }
    }

    const remixedIdea = generateIdea({
      genreIds: newGenreIds,
      mechanicIds: newMechanicIds.length > 0 ? newMechanicIds : undefined,
    });

    return {
      success: true,
      message: `Remixed idea: "${remixedIdea.title}" (changed ${dimension}).`,
      result: {
        id: remixedIdea.id,
        title: remixedIdea.title,
        description: remixedIdea.description,
        primaryGenre: remixedIdea.genreMix.primary.name,
        secondaryGenre: remixedIdea.genreMix.secondary.name,
        mechanics: remixedIdea.mechanicCombo.mechanics.map((m) => m.name),
        score: remixedIdea.score,
        hooks: remixedIdea.hooks,
        targetAudience: remixedIdea.targetAudience,
        dimensionChanged: dimension,
        templateMatch: resolveTemplate([
          remixedIdea.genreMix.primary.id,
          remixedIdea.genreMix.secondary.id,
        ]),
      },
    };
  },
};
