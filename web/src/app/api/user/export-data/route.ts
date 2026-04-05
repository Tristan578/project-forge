import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { withApiMiddleware } from '@/lib/api/middleware';
import { getDb, queryWithResilience } from '@/lib/db/client';
import { captureException } from '@/lib/monitoring/sentry-server';
import {
  users,
  projects,
  tokenUsage,
  tokenPurchases,
  creditTransactions,
  costLog,
  publishedGames,
  generationJobs,
  feedback,
  providerKeys,
  apiKeys,
} from '@/lib/db/schema';

/**
 * GET /api/user/export-data
 * GDPR data export endpoint. Returns all user data as a JSON download.
 * Requires authentication. Sensitive fields (encrypted keys, hashes) are excluded.
 */
export async function GET(req: NextRequest) {
  const mid = await withApiMiddleware(req, {
    requireAuth: true,
    rateLimit: true,
    rateLimitConfig: { key: (id) => `user:export-data:${id}`, max: 5, windowSeconds: 60 },
  });
  if (mid.error) return mid.error;

  const userId = mid.userId!;

  try {
    const db = getDb();

    const [
      userProfile,
      userProjects,
      userTokenUsage,
      userTokenPurchases,
      userCreditTransactions,
      userCostLog,
      userPublishedGames,
      userGenerationJobs,
      userFeedback,
      userProviderKeys,
      userApiKeys,
    ] = await Promise.all([
      db.select({
        id: users.id,
        email: users.email,
        displayName: users.displayName,
        tier: users.tier,
        monthlyTokens: users.monthlyTokens,
        monthlyTokensUsed: users.monthlyTokensUsed,
        addonTokens: users.addonTokens,
        earnedCredits: users.earnedCredits,
        billingCycleStart: users.billingCycleStart,
        createdAt: users.createdAt,
        updatedAt: users.updatedAt,
      }).from(users).where(eq(users.id, userId)),

      db.select({
        id: projects.id,
        name: projects.name,
        entityCount: projects.entityCount,
        formatVersion: projects.formatVersion,
        createdAt: projects.createdAt,
        updatedAt: projects.updatedAt,
      }).from(projects).where(eq(projects.userId, userId)),

      db.select({
        id: tokenUsage.id,
        operation: tokenUsage.operation,
        tokens: tokenUsage.tokens,
        source: tokenUsage.source,
        provider: tokenUsage.provider,
        createdAt: tokenUsage.createdAt,
      }).from(tokenUsage).where(eq(tokenUsage.userId, userId)),

      db.select({
        id: tokenPurchases.id,
        package: tokenPurchases.package,
        tokens: tokenPurchases.tokens,
        amountCents: tokenPurchases.amountCents,
        createdAt: tokenPurchases.createdAt,
      }).from(tokenPurchases).where(eq(tokenPurchases.userId, userId)),

      db.select({
        id: creditTransactions.id,
        transactionType: creditTransactions.transactionType,
        amount: creditTransactions.amount,
        balanceAfter: creditTransactions.balanceAfter,
        source: creditTransactions.source,
        createdAt: creditTransactions.createdAt,
      }).from(creditTransactions).where(eq(creditTransactions.userId, userId)),

      db.select({
        id: costLog.id,
        actionType: costLog.actionType,
        provider: costLog.provider,
        tokensCharged: costLog.tokensCharged,
        createdAt: costLog.createdAt,
      }).from(costLog).where(eq(costLog.userId, userId)),

      db.select({
        id: publishedGames.id,
        slug: publishedGames.slug,
        title: publishedGames.title,
        description: publishedGames.description,
        status: publishedGames.status,
        version: publishedGames.version,
        playCount: publishedGames.playCount,
        createdAt: publishedGames.createdAt,
        updatedAt: publishedGames.updatedAt,
      }).from(publishedGames).where(eq(publishedGames.userId, userId)),

      db.select({
        id: generationJobs.id,
        type: generationJobs.type,
        prompt: generationJobs.prompt,
        status: generationJobs.status,
        provider: generationJobs.provider,
        tokenCost: generationJobs.tokenCost,
        createdAt: generationJobs.createdAt,
        completedAt: generationJobs.completedAt,
      }).from(generationJobs).where(eq(generationJobs.userId, userId)),

      db.select({
        id: feedback.id,
        type: feedback.type,
        description: feedback.description,
        createdAt: feedback.createdAt,
      }).from(feedback).where(eq(feedback.userId, userId)),

      // Provider keys: only expose provider name and creation date, NOT the encrypted key
      db.select({
        id: providerKeys.id,
        provider: providerKeys.provider,
        createdAt: providerKeys.createdAt,
      }).from(providerKeys).where(eq(providerKeys.userId, userId)),

      // API keys: only expose name, prefix, scopes, NOT the hash
      db.select({
        id: apiKeys.id,
        name: apiKeys.name,
        keyPrefix: apiKeys.keyPrefix,
        scopes: apiKeys.scopes,
        lastUsed: apiKeys.lastUsed,
        expiresAt: apiKeys.expiresAt,
        createdAt: apiKeys.createdAt,
      }).from(apiKeys).where(eq(apiKeys.userId, userId)),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      profile: userProfile[0] ?? null,
      projects: userProjects,
      tokenUsage: userTokenUsage,
      tokenPurchases: userTokenPurchases,
      creditTransactions: userCreditTransactions,
      costLog: userCostLog,
      publishedGames: userPublishedGames,
      generationJobs: userGenerationJobs,
      feedback: userFeedback,
      providerKeys: userProviderKeys,
      apiKeys: userApiKeys,
    };

    return new NextResponse(JSON.stringify(exportData, null, 2), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="spawnforge-data-export.json"',
      },
    });
  } catch (err) {
    captureException(err, { route: '/api/user/export-data' });
    return NextResponse.json(
      { error: 'Failed to export user data' },
      { status: 500 }
    );
  }
}
