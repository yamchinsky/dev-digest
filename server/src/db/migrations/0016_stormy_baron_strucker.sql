ALTER TABLE "ci_runs" ADD COLUMN "agent" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "duration_s" double precision;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "github_run_id" text;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "critical" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "warning" integer;--> statement-breakpoint
ALTER TABLE "ci_runs" ADD COLUMN "suggestion" integer;--> statement-breakpoint
CREATE UNIQUE INDEX "ci_runs_installation_run_id_idx" ON "ci_runs" USING btree ("ci_installation_id","github_run_id");