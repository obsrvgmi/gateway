ALTER TABLE "payment_links" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "single_use" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payment_links" ADD COLUMN "public_stats" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "widgets" ADD COLUMN "public_stats" boolean DEFAULT false NOT NULL;