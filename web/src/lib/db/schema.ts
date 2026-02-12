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

export const tierEnum = pgEnum('tier', ['free', 'starter', 'creator', 'studio']);

export const providerEnum = pgEnum('provider', [
  'anthropic',
  'meshy',
  'hyper3d',
  'elevenlabs',
  'suno',
]);

export const tokenSourceEnum = pgEnum('token_source', ['monthly', 'addon', 'mixed']);

export const tokenPackageEnum = pgEnum('token_package', ['spark', 'blaze', 'inferno']);

// --- Tables ---

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  clerkId: text('clerk_id').notNull().unique(),
  email: text('email').notNull().unique(),
  displayName: text('display_name'),
  tier: tierEnum('tier').notNull().default('free'),

  // Token balance
  monthlyTokens: integer('monthly_tokens').notNull().default(0),
  monthlyTokensUsed: integer('monthly_tokens_used').notNull().default(0),
  addonTokens: integer('addon_tokens').notNull().default(0),

  // Billing
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  billingCycleStart: timestamp('billing_cycle_start', { withTimezone: true }),

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

// --- Types ---

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type ProviderKey = typeof providerKeys.$inferSelect;
export type TokenUsageRecord = typeof tokenUsage.$inferSelect;
export type TokenPurchase = typeof tokenPurchases.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type NewProject = typeof projects.$inferInsert;

export type Tier = 'free' | 'starter' | 'creator' | 'studio';
export type Provider = 'anthropic' | 'meshy' | 'hyper3d' | 'elevenlabs' | 'suno';
export type ApiKeyScope = 'scene:read' | 'scene:write' | 'ai:generate' | 'project:manage';
