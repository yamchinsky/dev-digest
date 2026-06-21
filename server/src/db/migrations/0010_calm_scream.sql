ALTER TABLE "conventions" ALTER COLUMN "repo_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ALTER COLUMN "confidence" SET DATA TYPE real;--> statement-breakpoint
ALTER TABLE "conventions" ALTER COLUMN "confidence" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "run_id" uuid NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "category" text NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "description" text;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_file" text NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence_line" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "edited_rule" text;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "conventions_repo_run_idx" ON "conventions" USING btree ("repo_id","run_id");--> statement-breakpoint
CREATE INDEX "conventions_repo_status_idx" ON "conventions" USING btree ("repo_id","status");--> statement-breakpoint
ALTER TABLE "conventions" DROP COLUMN "evidence_path";--> statement-breakpoint
ALTER TABLE "conventions" DROP COLUMN "accepted";--> statement-breakpoint
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_status_chk" CHECK ("conventions"."status" IN ('pending', 'approved', 'rejected'));