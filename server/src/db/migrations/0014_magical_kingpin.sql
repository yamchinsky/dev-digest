CREATE TABLE "eval_run_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid,
	"status" text DEFAULT 'running' NOT NULL,
	"agent_version" integer,
	"system_prompt" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"strategy" text DEFAULT 'auto' NOT NULL,
	"skill_bodies" jsonb,
	"cases_total" integer NOT NULL,
	"cases_passed" integer,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"cost_usd" double precision,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "batch_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_run_batches" ADD CONSTRAINT "eval_run_batches_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_run_batches" ADD CONSTRAINT "eval_run_batches_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_batch_id_eval_run_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."eval_run_batches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "eval_cases_workspace_owner_name_uidx" ON "eval_cases" USING btree ("workspace_id","owner_id","name");