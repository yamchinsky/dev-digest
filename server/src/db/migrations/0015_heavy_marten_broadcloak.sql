CREATE TABLE "skill_eval_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"skill_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"skill_version" integer,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"with_metrics" jsonb,
	"without_metrics" jsonb,
	"cases" jsonb,
	"cost_usd" double precision,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "skill_eval_runs" ADD CONSTRAINT "skill_eval_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_eval_runs" ADD CONSTRAINT "skill_eval_runs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_eval_runs_skill_idx" ON "skill_eval_runs" USING btree ("workspace_id","skill_id");