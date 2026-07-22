-- Hand-added (PF-985 / #8977): drizzle-kit does not emit this statement for
-- the built-in `vector` column type. Must run before graph_nodes.embedding
-- (vector(1536)) is created below.
CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."graph_edge_type" AS ENUM('contains', 'references', 'script_bound_to', 'spawned_from_prompt', 'derived_from');--> statement-breakpoint
CREATE TYPE "public"."graph_node_kind" AS ENUM('project', 'scene', 'entity', 'asset', 'script', 'generation');--> statement-breakpoint
CREATE TABLE "graph_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"type" "graph_edge_type" NOT NULL,
	"src_node_id" uuid NOT NULL,
	"dst_node_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE "graph_nodes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"kind" "graph_node_kind" NOT NULL,
	"ref_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" vector(1536),
	"text" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_src_node_id_graph_nodes_id_fk" FOREIGN KEY ("src_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_edges" ADD CONSTRAINT "graph_edges_dst_node_id_graph_nodes_id_fk" FOREIGN KEY ("dst_node_id") REFERENCES "public"."graph_nodes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "graph_nodes" ADD CONSTRAINT "graph_nodes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "uq_graph_edges_user_type_src_dst" ON "graph_edges" USING btree ("user_id","type","src_node_id","dst_node_id");--> statement-breakpoint
CREATE INDEX "idx_graph_edges_user_src" ON "graph_edges" USING btree ("user_id","src_node_id");--> statement-breakpoint
CREATE INDEX "idx_graph_edges_user_dst" ON "graph_edges" USING btree ("user_id","dst_node_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_graph_nodes_user_project_kind_ref" ON "graph_nodes" USING btree ("user_id","project_id","kind","ref_id");--> statement-breakpoint
CREATE INDEX "idx_graph_nodes_user_project_kind" ON "graph_nodes" USING btree ("user_id","project_id","kind");--> statement-breakpoint
CREATE INDEX "idx_graph_nodes_embedding_hnsw" ON "graph_nodes" USING hnsw ("embedding" vector_cosine_ops) WHERE "embedding" IS NOT NULL;
