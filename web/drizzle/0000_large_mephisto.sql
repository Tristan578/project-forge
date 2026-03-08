CREATE TYPE "public"."asset_category" AS ENUM('model_3d', 'sprite', 'texture', 'audio', 'script', 'prefab', 'template', 'shader', 'animation');--> statement-breakpoint
CREATE TYPE "public"."asset_license" AS ENUM('standard', 'extended');--> statement-breakpoint
CREATE TYPE "public"."asset_status" AS ENUM('draft', 'pending_review', 'published', 'rejected', 'removed');--> statement-breakpoint
CREATE TYPE "public"."feedback_type" AS ENUM('bug', 'feature', 'general');--> statement-breakpoint
CREATE TYPE "public"."generation_type" AS ENUM('model', 'texture', 'sfx', 'voice', 'skybox', 'music', 'sprite', 'sprite_sheet', 'tileset');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('pending', 'processing', 'downloading', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('anthropic', 'meshy', 'hyper3d', 'elevenlabs', 'suno', 'openai', 'replicate', 'removebg');--> statement-breakpoint
CREATE TYPE "public"."publish_status" AS ENUM('published', 'unpublished', 'processing');--> statement-breakpoint
CREATE TYPE "public"."tier" AS ENUM('starter', 'hobbyist', 'creator', 'pro');--> statement-breakpoint
CREATE TYPE "public"."token_package" AS ENUM('spark', 'blaze', 'inferno');--> statement-breakpoint
CREATE TYPE "public"."token_source" AS ENUM('monthly', 'addon', 'mixed');--> statement-breakpoint
CREATE TYPE "public"."transaction_type" AS ENUM('monthly_grant', 'purchase', 'deduction', 'refund', 'rollover', 'earned', 'adjustment');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"scopes" text[] DEFAULT '{"scene:read","scene:write","ai:generate","project:manage"}' NOT NULL,
	"last_used" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"buyer_id" uuid NOT NULL,
	"asset_id" uuid NOT NULL,
	"price_tokens" integer NOT NULL,
	"license" "asset_license" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "asset_reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"asset_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"content" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cost_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"action_type" text NOT NULL,
	"provider" text,
	"actual_cost_cents" integer,
	"tokens_charged" integer NOT NULL,
	"request_metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"transaction_type" "transaction_type" NOT NULL,
	"amount" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"source" text,
	"reference_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "featured_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"featured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "feedback" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"type" "feedback_type" NOT NULL,
	"description" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"content" text NOT NULL,
	"parent_id" uuid,
	"flagged" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_forks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"original_game_id" uuid NOT NULL,
	"forked_project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_likes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_ratings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"rating" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"game_id" uuid NOT NULL,
	"tag" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid,
	"provider" text NOT NULL,
	"provider_job_id" text NOT NULL,
	"type" "generation_type" NOT NULL,
	"prompt" text NOT NULL,
	"parameters" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'pending' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"result_url" text,
	"result_meta" jsonb,
	"imported" integer DEFAULT 0 NOT NULL,
	"token_cost" integer DEFAULT 0 NOT NULL,
	"token_usage_id" text,
	"refunded" integer DEFAULT 0 NOT NULL,
	"entity_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "marketplace_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"seller_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"category" "asset_category" NOT NULL,
	"status" "asset_status" DEFAULT 'draft' NOT NULL,
	"license" "asset_license" DEFAULT 'standard' NOT NULL,
	"price_tokens" integer DEFAULT 0 NOT NULL,
	"preview_url" text,
	"asset_file_url" text,
	"asset_file_size" integer,
	"tags" text[] DEFAULT '{}' NOT NULL,
	"metadata_json" jsonb,
	"ai_generated" integer DEFAULT 0 NOT NULL,
	"ai_provider" text,
	"download_count" integer DEFAULT 0 NOT NULL,
	"avg_rating" integer,
	"rating_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "processed_webhook_events" (
	"event_id" text PRIMARY KEY NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text DEFAULT 'Untitled Project' NOT NULL,
	"scene_data" jsonb NOT NULL,
	"thumbnail" text,
	"entity_count" integer DEFAULT 0 NOT NULL,
	"format_version" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "provider_keys" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"encrypted_key" text NOT NULL,
	"iv" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "published_games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" "publish_status" DEFAULT 'processing' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"cdn_url" text,
	"play_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "seller_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"portfolio_url" text,
	"total_earnings" integer DEFAULT 0 NOT NULL,
	"total_sales" integer DEFAULT 0 NOT NULL,
	"approved" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "seller_profiles_user_id_unique" UNIQUE("user_id")
);
--> statement-breakpoint
CREATE TABLE "tier_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tier_id" text NOT NULL,
	"monthly_tokens" integer NOT NULL,
	"rollover_months" integer DEFAULT 1 NOT NULL,
	"max_rollover_cap" integer DEFAULT 0 NOT NULL,
	"max_projects" integer DEFAULT 3 NOT NULL,
	"max_published" integer DEFAULT 0 NOT NULL,
	"price_cents_monthly" integer DEFAULT 0 NOT NULL,
	"features_json" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tier_config_tier_id_unique" UNIQUE("tier_id")
);
--> statement-breakpoint
CREATE TABLE "token_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action_type" text NOT NULL,
	"token_cost" integer NOT NULL,
	"provider" text,
	"estimated_cost_cents" integer,
	"active" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "token_config_action_type_unique" UNIQUE("action_type")
);
--> statement-breakpoint
CREATE TABLE "token_purchases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_payment_intent" text NOT NULL,
	"package" "token_package" NOT NULL,
	"tokens" integer NOT NULL,
	"amount_cents" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "token_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"tokens" integer NOT NULL,
	"source" "token_source" NOT NULL,
	"provider" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_follows" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"follower_id" uuid NOT NULL,
	"following_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"clerk_id" text NOT NULL,
	"email" text NOT NULL,
	"display_name" text,
	"tier" "tier" DEFAULT 'starter' NOT NULL,
	"monthly_tokens" integer DEFAULT 0 NOT NULL,
	"monthly_tokens_used" integer DEFAULT 0 NOT NULL,
	"addon_tokens" integer DEFAULT 0 NOT NULL,
	"earned_credits" integer DEFAULT 0 NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"billing_cycle_start" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_clerk_id_unique" UNIQUE("clerk_id"),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_purchases" ADD CONSTRAINT "asset_purchases_buyer_id_users_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_purchases" ADD CONSTRAINT "asset_purchases_asset_id_marketplace_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."marketplace_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_reviews" ADD CONSTRAINT "asset_reviews_asset_id_marketplace_assets_id_fk" FOREIGN KEY ("asset_id") REFERENCES "public"."marketplace_assets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "asset_reviews" ADD CONSTRAINT "asset_reviews_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_log" ADD CONSTRAINT "cost_log_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "featured_games" ADD CONSTRAINT "featured_games_game_id_published_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."published_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_comments" ADD CONSTRAINT "game_comments_game_id_published_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."published_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_comments" ADD CONSTRAINT "game_comments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_forks" ADD CONSTRAINT "game_forks_original_game_id_published_games_id_fk" FOREIGN KEY ("original_game_id") REFERENCES "public"."published_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_forks" ADD CONSTRAINT "game_forks_forked_project_id_projects_id_fk" FOREIGN KEY ("forked_project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_forks" ADD CONSTRAINT "game_forks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_likes" ADD CONSTRAINT "game_likes_game_id_published_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."published_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_likes" ADD CONSTRAINT "game_likes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_ratings" ADD CONSTRAINT "game_ratings_game_id_published_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."published_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_ratings" ADD CONSTRAINT "game_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_tags" ADD CONSTRAINT "game_tags_game_id_published_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."published_games"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_jobs" ADD CONSTRAINT "generation_jobs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_assets" ADD CONSTRAINT "marketplace_assets_seller_id_users_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_keys" ADD CONSTRAINT "provider_keys_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_games" ADD CONSTRAINT "published_games_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "published_games" ADD CONSTRAINT "published_games_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_profiles" ADD CONSTRAINT "seller_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_purchases" ADD CONSTRAINT "token_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_usage" ADD CONSTRAINT "token_usage_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_follower_id_users_id_fk" FOREIGN KEY ("follower_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_follows" ADD CONSTRAINT "user_follows_following_id_users_id_fk" FOREIGN KEY ("following_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_api_keys_user" ON "api_keys" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_asset_purchases_buyer_asset" ON "asset_purchases" USING btree ("buyer_id","asset_id");--> statement-breakpoint
CREATE INDEX "idx_asset_purchases_buyer" ON "asset_purchases" USING btree ("buyer_id");--> statement-breakpoint
CREATE INDEX "idx_asset_purchases_asset" ON "asset_purchases" USING btree ("asset_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_asset_reviews_user_asset" ON "asset_reviews" USING btree ("asset_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_asset_reviews_asset" ON "asset_reviews" USING btree ("asset_id");--> statement-breakpoint
CREATE INDEX "idx_cost_log_user_date" ON "cost_log" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_cost_log_action" ON "cost_log" USING btree ("action_type");--> statement-breakpoint
CREATE INDEX "idx_credit_txn_user_date" ON "credit_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_featured_games_position" ON "featured_games" USING btree ("position");--> statement-breakpoint
CREATE INDEX "idx_feedback_user" ON "feedback" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_feedback_type" ON "feedback" USING btree ("type");--> statement-breakpoint
CREATE INDEX "idx_game_comments_game" ON "game_comments" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "idx_game_comments_user" ON "game_comments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_game_forks_original" ON "game_forks" USING btree ("original_game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_game_likes_user_game" ON "game_likes" USING btree ("game_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_game_likes_game" ON "game_likes" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_game_ratings_user_game" ON "game_ratings" USING btree ("game_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_game_ratings_game" ON "game_ratings" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "idx_game_tags_game" ON "game_tags" USING btree ("game_id");--> statement-breakpoint
CREATE INDEX "idx_game_tags_tag" ON "game_tags" USING btree ("tag");--> statement-breakpoint
CREATE INDEX "idx_generation_jobs_user_status" ON "generation_jobs" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "idx_generation_jobs_user_created" ON "generation_jobs" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_marketplace_assets_seller" ON "marketplace_assets" USING btree ("seller_id");--> statement-breakpoint
CREATE INDEX "idx_marketplace_assets_category" ON "marketplace_assets" USING btree ("category");--> statement-breakpoint
CREATE INDEX "idx_marketplace_assets_status" ON "marketplace_assets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_projects_user" ON "projects" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_projects_updated" ON "projects" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_provider_keys_user_provider" ON "provider_keys" USING btree ("user_id","provider");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_published_games_slug" ON "published_games" USING btree ("user_id","slug");--> statement-breakpoint
CREATE INDEX "idx_published_games_user" ON "published_games" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_seller_profiles_user" ON "seller_profiles" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_token_usage_user_date" ON "token_usage" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_user_follows" ON "user_follows" USING btree ("follower_id","following_id");--> statement-breakpoint
CREATE INDEX "idx_user_follows_following" ON "user_follows" USING btree ("following_id");