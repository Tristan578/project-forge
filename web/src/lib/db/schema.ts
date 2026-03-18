import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
  jsonb,
  uniqueIndex,
  index,
  pgEnum,
} from 'drizzle-orm/pg-core';

// --- Enums ---

export const tierEnum = pgEnum('tier', ['starter', 'hobbyist', 'creator', 'pro']);

export const providerEnum = pgEnum('provider', [
  'anthropic',
  'meshy',
  'hyper3d',
  'elevenlabs',
  'suno',
  'openai',
  'replicate',
  'removebg',
]);

export const tokenSourceEnum = pgEnum('token_source', ['monthly', 'addon', 'mixed']);

export const tokenPackageEnum = pgEnum('token_package', ['spark', 'blaze', 'inferno']);

export const feedbackTypeEnum = pgEnum('feedback_type', ['bug', 'feature', 'general']);

export const transactionTypeEnum = pgEnum('transaction_type', [
  'monthly_grant', 'purchase', 'deduction', 'refund', 'rollover', 'earned', 'adjustment',
]);

// --- Tables ---

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: text('clerk_id').notNull().unique(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  tier: tierEnum('tier').notNull().default('starter'),

  // Token balance
  monthlyTokens: integer('monthly_tokens').notNull().default(0),
  monthlyTokensUsed: integer('monthly_tokens_used').notNull().default(0),
  addonTokens: integer('addon_tokens').notNull().default(0),
  earnedCredits: integer('earned_credits').notNull().default(0),

  // Billing
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  billingCycleStart: timestamp('billing_cycle_start', { withTimezone: true }),

  banned: integer('banned').notNull().default(0),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const apiKeys = pgTable(
  'api_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull(),
    keyHash: text('key_hash').notNull(),
    keyPrefix: text('key_prefix').notNull(),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(['scene:read', 'scene:write', 'ai:generate', 'project:manage']),
    lastUsed: timestamp('last_used', { withTimezone: true }),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_api_keys_user').on(table.userId)]
);

export const providerKeys = pgTable(
  'provider_keys',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    provider: providerEnum('provider').notNull(),
    encryptedKey: text('encrypted_key').notNull(),
    iv: text('iv').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('uq_provider_keys_user_provider').on(table.userId, table.provider)]
);

export const tokenUsage = pgTable(
  'token_usage',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    operation: text('operation').notNull(),
    tokens: integer('tokens').notNull(),
    source: tokenSourceEnum('source').notNull(),
    provider: text('provider'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('idx_token_usage_user_date').on(table.userId, table.createdAt)]
);

export const tokenPurchases = pgTable('token_purchases', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id),
  stripePaymentIntent: text('stripe_payment_intent').notNull(),
  package: tokenPackageEnum('package').notNull(),
  tokens: integer('tokens').notNull(),
  amountCents: integer('amount_cents').notNull(),
  // PF-526: Track cumulative refunded amount to prevent double-deduction
  // when multiple partial refunds are issued for the same charge.
  refundedCents: integer('refunded_cents').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const projects = pgTable(
  'projects',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    name: text('name').notNull().default('Untitled Project'),
    sceneData: jsonb('scene_data').notNull(),
    thumbnail: text('thumbnail'),
    entityCount: integer('entity_count').notNull().default(0),
    formatVersion: integer('format_version').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_projects_user').on(table.userId),
    index('idx_projects_updated').on(table.userId, table.updatedAt),
  ]
);

export const tokenConfig = pgTable('token_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  actionType: text('action_type').notNull().unique(),
  tokenCost: integer('token_cost').notNull(),
  provider: text('provider'),
  estimatedCostCents: integer('estimated_cost_cents'),
  active: integer('active').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const tierConfig = pgTable('tier_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  tierId: text('tier_id').notNull().unique(),
  monthlyTokens: integer('monthly_tokens').notNull(),
  rolloverMonths: integer('rollover_months').notNull().default(1),
  maxRolloverCap: integer('max_rollover_cap').notNull().default(0),
  maxProjects: integer('max_projects').notNull().default(3),
  maxPublished: integer('max_published').notNull().default(0),
  priceCentsMonthly: integer('price_cents_monthly').notNull().default(0),
  featuresJson: jsonb('features_json'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const costLog = pgTable(
  'cost_log',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    actionType: text('action_type').notNull(),
    provider: text('provider'),
    actualCostCents: integer('actual_cost_cents'),
    tokensCharged: integer('tokens_charged').notNull(),
    requestMetadata: jsonb('request_metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_cost_log_user_date').on(table.userId, table.createdAt),
    index('idx_cost_log_action').on(table.actionType),
  ]
);

export const creditTransactions = pgTable(
  'credit_transactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id),
    transactionType: transactionTypeEnum('transaction_type').notNull(),
    amount: integer('amount').notNull(),
    balanceAfter: integer('balance_after').notNull(),
    source: text('source'),
    referenceId: text('reference_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_credit_txn_user_date').on(table.userId, table.createdAt),
  ]
);

export const publishStatusEnum = pgEnum('publish_status', ['published', 'unpublished', 'processing']);

export const publishedGames = pgTable(
  'published_games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    projectId: uuid('project_id').notNull().references(() => projects.id),
    slug: text('slug').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    status: publishStatusEnum('status').notNull().default('processing'),
    version: integer('version').notNull().default(1),
    cdnUrl: text('cdn_url'),
    thumbnail: text('thumbnail'),
    playCount: integer('play_count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_published_games_slug').on(table.userId, table.slug),
    index('idx_published_games_user').on(table.userId),
    index('idx_published_games_slug').on(table.slug),
  ]
);

// --- Community Gallery Tables ---

export const gameRatings = pgTable(
  'game_ratings',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id').notNull().references(() => publishedGames.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    rating: integer('rating').notNull(), // 1-5 stars
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_game_ratings_user_game').on(table.gameId, table.userId),
    index('idx_game_ratings_game').on(table.gameId),
  ]
);

export const gameComments = pgTable(
  'game_comments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id').notNull().references(() => publishedGames.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    content: text('content').notNull(),
    parentId: uuid('parent_id'), // For replies
    flagged: integer('flagged').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_game_comments_game').on(table.gameId),
    index('idx_game_comments_user').on(table.userId),
  ]
);

export const gameLikes = pgTable(
  'game_likes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id').notNull().references(() => publishedGames.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_game_likes_user_game').on(table.gameId, table.userId),
    index('idx_game_likes_game').on(table.gameId),
  ]
);

export const userFollows = pgTable(
  'user_follows',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    followerId: uuid('follower_id').notNull().references(() => users.id),
    followingId: uuid('following_id').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_user_follows').on(table.followerId, table.followingId),
    index('idx_user_follows_following').on(table.followingId),
  ]
);

export const gameTags = pgTable(
  'game_tags',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id').notNull().references(() => publishedGames.id),
    tag: text('tag').notNull(),
  },
  (table) => [
    index('idx_game_tags_game').on(table.gameId),
    index('idx_game_tags_tag').on(table.tag),
  ]
);

export const gameForks = pgTable(
  'game_forks',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    originalGameId: uuid('original_game_id').notNull().references(() => publishedGames.id),
    forkedProjectId: uuid('forked_project_id').notNull().references(() => projects.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_game_forks_original').on(table.originalGameId),
  ]
);

export const featuredGames = pgTable(
  'featured_games',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: uuid('game_id').notNull().references(() => publishedGames.id),
    position: integer('position').notNull().default(0),
    featuredAt: timestamp('featured_at', { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_featured_games_position').on(table.position),
  ]
);

// --- Asset Marketplace Tables ---

export const assetCategoryEnum = pgEnum('asset_category', [
  'model_3d', 'sprite', 'texture', 'audio', 'script', 'prefab', 'template', 'shader', 'animation',
]);

export const assetStatusEnum = pgEnum('asset_status', [
  'draft', 'pending_review', 'published', 'rejected', 'removed',
]);

export const assetLicenseEnum = pgEnum('asset_license', ['standard', 'extended']);

export const marketplaceAssets = pgTable(
  'marketplace_assets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    sellerId: uuid('seller_id').notNull().references(() => users.id),
    name: text('name').notNull(),
    description: text('description').notNull(),
    category: assetCategoryEnum('category').notNull(),
    status: assetStatusEnum('status').notNull().default('draft'),
    license: assetLicenseEnum('license').notNull().default('standard'),

    // Pricing (in platform tokens, 0 = free)
    priceTokens: integer('price_tokens').notNull().default(0),

    // Files
    previewUrl: text('preview_url'),
    assetFileUrl: text('asset_file_url'),
    assetFileSize: integer('asset_file_size'),

    // Metadata
    tags: text('tags').array().notNull().default([]),
    metadataJson: jsonb('metadata_json'),
    aiGenerated: integer('ai_generated').notNull().default(0),
    aiProvider: text('ai_provider'),

    // Stats
    downloadCount: integer('download_count').notNull().default(0),
    avgRating: integer('avg_rating'),
    ratingCount: integer('rating_count').notNull().default(0),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    publishedAt: timestamp('published_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_marketplace_assets_seller').on(table.sellerId),
    index('idx_marketplace_assets_category').on(table.category),
    index('idx_marketplace_assets_status').on(table.status),
  ]
);

export const assetPurchases = pgTable(
  'asset_purchases',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    buyerId: uuid('buyer_id').notNull().references(() => users.id),
    assetId: uuid('asset_id').notNull().references(() => marketplaceAssets.id),
    priceTokens: integer('price_tokens').notNull(),
    license: assetLicenseEnum('license').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_asset_purchases_buyer_asset').on(table.buyerId, table.assetId),
    index('idx_asset_purchases_buyer').on(table.buyerId),
    index('idx_asset_purchases_asset').on(table.assetId),
  ]
);

export const assetReviews = pgTable(
  'asset_reviews',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    assetId: uuid('asset_id').notNull().references(() => marketplaceAssets.id),
    userId: uuid('user_id').notNull().references(() => users.id),
    rating: integer('rating').notNull(),
    content: text('content'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('uq_asset_reviews_user_asset').on(table.assetId, table.userId),
    index('idx_asset_reviews_asset').on(table.assetId),
  ]
);

export const sellerProfiles = pgTable(
  'seller_profiles',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id).unique(),
    displayName: text('display_name').notNull(),
    bio: text('bio'),
    portfolioUrl: text('portfolio_url'),
    totalEarnings: integer('total_earnings').notNull().default(0),
    totalSales: integer('total_sales').notNull().default(0),
    approved: integer('approved').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_seller_profiles_user').on(table.userId),
  ]
);

export const feedback = pgTable(
  'feedback',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').references(() => users.id),
    type: feedbackTypeEnum('type').notNull(),
    description: text('description').notNull(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_feedback_user').on(table.userId),
    index('idx_feedback_type').on(table.type),
  ]
);

// --- Generation Jobs ---

export const jobStatusEnum = pgEnum('job_status', [
  'pending', 'processing', 'downloading', 'completed', 'failed', 'cancelled',
]);

export const generationTypeEnum = pgEnum('generation_type', [
  'model', 'texture', 'sfx', 'voice', 'skybox', 'music', 'sprite', 'sprite_sheet', 'tileset',
]);

export const generationJobs = pgTable(
  'generation_jobs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    projectId: uuid('project_id').references(() => projects.id),
    provider: text('provider').notNull(),
    providerJobId: text('provider_job_id').notNull(),
    type: generationTypeEnum('type').notNull(),
    prompt: text('prompt').notNull(),
    parameters: jsonb('parameters').notNull().default({}),
    status: jobStatusEnum('status').notNull().default('pending'),
    progress: integer('progress').notNull().default(0),
    errorMessage: text('error_message'),
    resultUrl: text('result_url'),
    resultMeta: jsonb('result_meta'),
    imported: integer('imported').notNull().default(0),
    tokenCost: integer('token_cost').notNull().default(0),
    tokenUsageId: text('token_usage_id'),
    refunded: integer('refunded').notNull().default(0),
    entityId: text('entity_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_generation_jobs_user_status').on(table.userId, table.status),
    index('idx_generation_jobs_user_created').on(table.userId, table.createdAt),
  ]
);

// --- Webhook Idempotency ---

export const webhookEvents = pgTable('webhook_events', {
  // PK is eventId only (not composite with source). Stripe and Clerk both
  // generate globally unique IDs (evt_* / evt_*), so cross-source collisions
  // are not a practical concern. The source column is for filtering/auditing.
  eventId: text('event_id').primaryKey(),
  source: text('source').notNull(), // 'stripe' | 'clerk'
  claimedAt: timestamp('claimed_at', { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});

// --- Content Moderation Appeals ---

export const appealStatusEnum = pgEnum('appeal_status', ['pending', 'approved', 'rejected']);

export const moderationAppeals = pgTable(
  'moderation_appeals',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id').notNull().references(() => users.id),
    contentId: text('content_id').notNull(),
    contentType: text('content_type').notNull(), // 'comment' | 'asset' | 'game'
    reason: text('reason').notNull(),
    status: appealStatusEnum('status').notNull().default('pending'),
    reviewedBy: text('reviewed_by'), // admin clerk ID
    reviewNote: text('review_note'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
  },
  (table) => [
    index('idx_moderation_appeals_user').on(table.userId),
    index('idx_moderation_appeals_status').on(table.status),
  ]
);

// --- Types ---

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ProviderKey = typeof providerKeys.$inferSelect;
export type TokenUsageRecord = typeof tokenUsage.$inferSelect;
export type TokenPurchase = typeof tokenPurchases.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type TokenConfig = typeof tokenConfig.$inferSelect;
export type TierConfig = typeof tierConfig.$inferSelect;
export type CostLogRecord = typeof costLog.$inferSelect;
export type CreditTransaction = typeof creditTransactions.$inferSelect;
export type PublishedGame = typeof publishedGames.$inferSelect;
export type NewPublishedGame = typeof publishedGames.$inferInsert;
export type TransactionType = 'monthly_grant' | 'purchase' | 'deduction' | 'refund' | 'rollover' | 'earned' | 'adjustment';

export type GameRating = typeof gameRatings.$inferSelect;
export type GameComment = typeof gameComments.$inferSelect;
export type GameLike = typeof gameLikes.$inferSelect;
export type UserFollow = typeof userFollows.$inferSelect;
export type GameTag = typeof gameTags.$inferSelect;
export type GameFork = typeof gameForks.$inferSelect;
export type FeaturedGame = typeof featuredGames.$inferSelect;

export type MarketplaceAsset = typeof marketplaceAssets.$inferSelect;
export type NewMarketplaceAsset = typeof marketplaceAssets.$inferInsert;
export type AssetPurchase = typeof assetPurchases.$inferSelect;
export type AssetReview = typeof assetReviews.$inferSelect;
export type SellerProfile = typeof sellerProfiles.$inferSelect;

export type GenerationJob = typeof generationJobs.$inferSelect;
export type NewGenerationJob = typeof generationJobs.$inferInsert;

export type Tier = 'starter' | 'hobbyist' | 'creator' | 'pro';
export type Provider = 'anthropic' | 'meshy' | 'hyper3d' | 'elevenlabs' | 'suno' | 'openai' | 'replicate' | 'removebg';
export type ApiKeyScope = 'scene:read' | 'scene:write' | 'ai:generate' | 'project:manage';
export type AssetCategory = 'model_3d' | 'sprite' | 'texture' | 'audio' | 'script' | 'prefab' | 'template' | 'shader' | 'animation';
export type AssetStatus = 'draft' | 'pending_review' | 'published' | 'rejected' | 'removed';
export type AssetLicense = 'standard' | 'extended';

export type Feedback = typeof feedback.$inferSelect;
export type NewFeedback = typeof feedback.$inferInsert;
export type FeedbackType = 'bug' | 'feature' | 'general';
export type ModerationAppeal = typeof moderationAppeals.$inferSelect;
export type NewModerationAppeal = typeof moderationAppeals.$inferInsert;
export type AppealStatus = 'pending' | 'approved' | 'rejected';
