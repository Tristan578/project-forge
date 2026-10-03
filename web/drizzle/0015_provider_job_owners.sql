CREATE TABLE "provider_job_owners" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"provider_job_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_job_owners" ADD CONSTRAINT "provider_job_owners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_provider_job_owners_provider_job" ON "provider_job_owners" USING btree ("provider","provider_job_id");--> statement-breakpoint
-- One-time backfill (#10262): bind every generation still in flight when this
-- migration runs, so its next status poll is not refused as 'not_owner'.
-- Binding namespaces are the status routes' DB_PROVIDER values: model, texture
-- and skybox poll meshy; sprite, sprite_sheet and tileset poll replicate.
-- generation_jobs rows are client-created, so a provider_job_id claimed by more
-- than one user is ambiguous and left unbound (fail closed), and only rows from
-- the last 24 hours are trusted. A single claimant IS trusted: a row planted
-- before this migration for a leaked id binds to the planter. That locks the
-- real owner out (404 and refund) but discloses nothing the planter could not
-- already poll before ownership existed.
INSERT INTO "provider_job_owners" ("provider", "provider_job_id", "user_id")
SELECT m."provider", gj."provider_job_id", gj."user_id"
FROM "generation_jobs" gj
JOIN (VALUES
  ('model', 'meshy'), ('texture', 'meshy'), ('skybox', 'meshy'),
  ('sprite', 'replicate'), ('sprite_sheet', 'replicate'), ('tileset', 'replicate')
) AS m("type", "provider") ON m."type" = gj."type"::text
WHERE gj."status" IN ('pending', 'processing', 'downloading')
  AND gj."created_at" > now() - interval '24 hours'
  AND NOT EXISTS (
    SELECT 1 FROM "generation_jobs" other
    WHERE other."provider_job_id" = gj."provider_job_id"
      AND other."user_id" <> gj."user_id"
  )
ON CONFLICT ("provider", "provider_job_id") DO NOTHING;
