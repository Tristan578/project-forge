import { describe, it, expect } from 'vitest';
import * as schema from '../schema';

describe('database schema', () => {
  it('exports all expected tables', () => {
    expect(schema.users).toBeDefined();
    expect(schema.apiKeys).toBeDefined();
    expect(schema.providerKeys).toBeDefined();
    expect(schema.tokenUsage).toBeDefined();
    expect(schema.tokenPurchases).toBeDefined();
    expect(schema.projects).toBeDefined();
    expect(schema.tokenConfig).toBeDefined();
    expect(schema.tierConfig).toBeDefined();
    expect(schema.costLog).toBeDefined();
    expect(schema.creditTransactions).toBeDefined();
    expect(schema.publishedGames).toBeDefined();
    expect(schema.gameRatings).toBeDefined();
    expect(schema.gameComments).toBeDefined();
    expect(schema.gameLikes).toBeDefined();
    expect(schema.userFollows).toBeDefined();
    expect(schema.gameTags).toBeDefined();
    expect(schema.gameForks).toBeDefined();
    expect(schema.featuredGames).toBeDefined();
    expect(schema.marketplaceAssets).toBeDefined();
    expect(schema.assetPurchases).toBeDefined();
    expect(schema.assetReviews).toBeDefined();
    expect(schema.sellerProfiles).toBeDefined();
    expect(schema.feedback).toBeDefined();
    expect(schema.generationJobs).toBeDefined();
  });

  it('exports enums', () => {
    expect(schema.tierEnum).toBeDefined();
    expect(schema.providerEnum).toBeDefined();
    expect(schema.tokenSourceEnum).toBeDefined();
    expect(schema.publishStatusEnum).toBeDefined();
    expect(schema.jobStatusEnum).toBeDefined();
  });
});
