import { eq, and, desc, count } from 'drizzle-orm';
import { getDb } from '../db/client';
import { projects, users, type Project } from '../db/schema';
import { PROJECT_LIMITS } from './limits';

/**
 * List all projects for a user, ordered by last updated.
 */
export async function listProjects(userId: string) {
  const db = getDb();
  const result = await db
    .select({
      id: projects.id,
      name: projects.name,
      thumbnail: projects.thumbnail,
      entityCount: projects.entityCount,
      updatedAt: projects.updatedAt,
    })
    .from(projects)
    .where(eq(projects.userId, userId))
    .orderBy(desc(projects.updatedAt));

  return result;
}

/**
 * Get a single project by ID. Returns null if not found or user doesn't own it.
 */
export async function getProject(userId: string, projectId: string): Promise<Project | null> {
  const db = getDb();
  const result = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .limit(1);

  return result[0] ?? null;
}

/**
 * Create a new project. Enforces tier-based project count limits.
 * @throws Error if project limit exceeded
 */
export async function createProject(
  userId: string,
  name: string,
  sceneData: unknown
): Promise<Project> {
  const db = getDb();

  // Get user's tier
  const userResult = await db.select({ tier: users.tier }).from(users).where(eq(users.id, userId)).limit(1);
  if (!userResult[0]) {
    throw new Error('User not found');
  }
  const tier = userResult[0].tier;

  // Check project count limit
  const projectCount = await getProjectCount(userId);
  const limit = PROJECT_LIMITS[tier as keyof typeof PROJECT_LIMITS];
  if (projectCount >= limit) {
    const error = new Error('Project limit exceeded') as Error & { limit?: number };
    error.limit = limit;
    throw error;
  }

  // Create project
  const result = await db
    .insert(projects)
    .values({
      userId,
      name,
      sceneData,
      entityCount: 0,
      formatVersion: 1,
    })
    .returning();

  return result[0];
}

/**
 * Update an existing project. Only updates provided fields.
 */
export async function updateProject(
  userId: string,
  projectId: string,
  updates: {
    name?: string;
    sceneData?: unknown;
    thumbnail?: string | null;
    entityCount?: number;
  }
): Promise<Project | null> {
  const db = getDb();

  const result = await db
    .update(projects)
    .set({
      ...updates,
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning();

  return result[0] ?? null;
}

/**
 * Delete a project. Returns true if deleted, false if not found.
 */
export async function deleteProject(userId: string, projectId: string): Promise<boolean> {
  const db = getDb();

  const result = await db
    .delete(projects)
    .where(and(eq(projects.id, projectId), eq(projects.userId, userId)))
    .returning();

  return result.length > 0;
}

/**
 * Get the count of projects for a user.
 */
export async function getProjectCount(userId: string): Promise<number> {
  const db = getDb();

  const result = await db
    .select({ count: count() })
    .from(projects)
    .where(eq(projects.userId, userId));

  return result[0]?.count ?? 0;
}
