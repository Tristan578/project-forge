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
  gameComments,
  gameRatings,
  gameLikes,
  userFollows,
  gameForks,
  marketplaceAssets,
  assetPurchases,
  assetReviews,
  sellerProfiles,
  moderationAppeals,
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
      userGameComments,
      userGameRatings,
      userGameLikes,
      userFollowing,
      userGameForks,
      userMarketplaceAssets,
      userAssetPurchases,
      userAssetReviews,
      userSellerProfile,
      userModerationAppeals,
    ] = await queryWithResilience(() => {
      // eslint-disable-next-line no-restricted-syntax -- db ref needed for Promise.all inside queryWithResilience
      const db = getDb();
      return Promise.all([
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

      // Community: comments the user authored
      db.select({
        id: gameComments.id,
        gameId: gameComments.gameId,
        content: gameComments.content,
        parentId: gameComments.parentId,
        createdAt: gameComments.createdAt,
      }).from(gameComments).where(eq(gameComments.userId, userId)),

      // Community: ratings the user gave
      db.select({
        id: gameRatings.id,
        gameId: gameRatings.gameId,
        rating: gameRatings.rating,
        createdAt: gameRatings.createdAt,
        updatedAt: gameRatings.updatedAt,
      }).from(gameRatings).where(eq(gameRatings.userId, userId)),

      // Community: likes the user gave
      db.select({
        id: gameLikes.id,
        gameId: gameLikes.gameId,
        createdAt: gameLikes.createdAt,
      }).from(gameLikes).where(eq(gameLikes.userId, userId)),

      // Social graph: accounts the user follows (the user's own action)
      db.select({
        id: userFollows.id,
        followingId: userFollows.followingId,
        createdAt: userFollows.createdAt,
      }).from(userFollows).where(eq(userFollows.followerId, userId)),

      // Community: forks the user created
      db.select({
        id: gameForks.id,
        originalGameId: gameForks.originalGameId,
        forkedProjectId: gameForks.forkedProjectId,
        createdAt: gameForks.createdAt,
      }).from(gameForks).where(eq(gameForks.userId, userId)),

      // Marketplace: assets the user listed for sale
      db.select({
        id: marketplaceAssets.id,
        name: marketplaceAssets.name,
        description: marketplaceAssets.description,
        priceTokens: marketplaceAssets.priceTokens,
        downloadCount: marketplaceAssets.downloadCount,
        createdAt: marketplaceAssets.createdAt,
        updatedAt: marketplaceAssets.updatedAt,
      }).from(marketplaceAssets).where(eq(marketplaceAssets.sellerId, userId)),

      // Marketplace: assets the user purchased
      db.select({
        id: assetPurchases.id,
        assetId: assetPurchases.assetId,
        priceTokens: assetPurchases.priceTokens,
        createdAt: assetPurchases.createdAt,
      }).from(assetPurchases).where(eq(assetPurchases.buyerId, userId)),

      // Marketplace: reviews the user wrote
      db.select({
        id: assetReviews.id,
        assetId: assetReviews.assetId,
        rating: assetReviews.rating,
        content: assetReviews.content,
        createdAt: assetReviews.createdAt,
      }).from(assetReviews).where(eq(assetReviews.userId, userId)),

      // Marketplace: the user's seller profile (no earnings internals beyond totals)
      db.select({
        id: sellerProfiles.id,
        displayName: sellerProfiles.displayName,
        bio: sellerProfiles.bio,
        portfolioUrl: sellerProfiles.portfolioUrl,
        totalEarnings: sellerProfiles.totalEarnings,
        totalSales: sellerProfiles.totalSales,
        createdAt: sellerProfiles.createdAt,
      }).from(sellerProfiles).where(eq(sellerProfiles.userId, userId)),

      // Moderation: appeals the user filed
      db.select({
        id: moderationAppeals.id,
        contentId: moderationAppeals.contentId,
        contentType: moderationAppeals.contentType,
        reason: moderationAppeals.reason,
        status: moderationAppeals.status,
        createdAt: moderationAppeals.createdAt,
        reviewedAt: moderationAppeals.reviewedAt,
      }).from(moderationAppeals).where(eq(moderationAppeals.userId, userId)),
    ]);
    });

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
      gameComments: userGameComments,
      gameRatings: userGameRatings,
      gameLikes: userGameLikes,
      following: userFollowing,
      gameForks: userGameForks,
      marketplaceAssets: userMarketplaceAssets,
      assetPurchases: userAssetPurchases,
      assetReviews: userAssetReviews,
      sellerProfile: userSellerProfile[0] ?? null,
      moderationAppeals: userModerationAppeals,
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
