CREATE TABLE "api_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"label" text NOT NULL,
	"prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" text,
	"actor_type" text NOT NULL,
	"actor_id" text,
	"action" text NOT NULL,
	"target" text,
	"detail" jsonb,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "destinations" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"label" text NOT NULL,
	"address" text NOT NULL,
	"message" text,
	"signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"removed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "heartbeats" (
	"name" text PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"org_id" text NOT NULL,
	"key" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "idempotency_keys_org_id_key_pk" PRIMARY KEY("org_id","key")
);
--> statement-breakpoint
CREATE TABLE "invites" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"token_hash" text NOT NULL,
	"invited_by" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invites_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "login_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"org_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memberships_org_id_user_id_pk" PRIMARY KEY("org_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"href" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"read_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"business_name" text NOT NULL,
	"receive_asset" text DEFAULT 'USDC' NOT NULL,
	"settlement_mode" text DEFAULT 'balance' NOT NULL,
	"wallet_address" text,
	"wallet_verified_at" timestamp with time zone,
	"branding" jsonb NOT NULL,
	"notifications" jsonb NOT NULL,
	"payout_schedule" text DEFAULT 'manual' NOT NULL,
	"hold_days" integer DEFAULT 0 NOT NULL,
	"minimum_usd" numeric(18, 2) DEFAULT '0' NOT NULL,
	"default_destination_id" text,
	"last_scheduled_prompt_at" timestamp with time zone,
	"terms_version" text,
	"terms_accepted_at" timestamp with time zone,
	"terms_accepted_by" text,
	"setup_dismissed" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payment_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"payment_id" text NOT NULL,
	"from_state" text,
	"to_state" text NOT NULL,
	"provider_status" text,
	"detail" jsonb,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_links" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"amount_usd" numeric(18, 2),
	"receive_asset" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"success_url" text DEFAULT '' NOT NULL,
	"sample" boolean DEFAULT false NOT NULL,
	"expiry_notice_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"source_type" text NOT NULL,
	"source_id" text NOT NULL,
	"source_name" text NOT NULL,
	"idempotency_key" text,
	"state" text NOT NULL,
	"pay_asset" text NOT NULL,
	"receive_asset" text NOT NULL,
	"usd" numeric(18, 6) NOT NULL,
	"fee_usd" numeric(18, 6) DEFAULT '0' NOT NULL,
	"pay_base" numeric(78, 0),
	"min_pay_base" numeric(78, 0),
	"receive_base" numeric(78, 0) NOT NULL,
	"payer" text NOT NULL,
	"customer_email" text,
	"settlement_mode" text NOT NULL,
	"recipient" text NOT NULL,
	"recipient_type" text NOT NULL,
	"deposit_address" text,
	"deposit_memo" text,
	"deadline" timestamp with time zone,
	"pay_by" timestamp with time zone,
	"quote" jsonb,
	"quote_signature" text,
	"correlation_id" text,
	"provider_status" text,
	"origin_tx_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"destination_tx_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"deposited_base" numeric(78, 0),
	"received_base" numeric(78, 0),
	"provider_refunded_base" numeric(78, 0),
	"provider_refund_reason" text,
	"failure_reason" text,
	"settle_seconds" integer,
	"refunded_base" numeric(78, 0) DEFAULT '0' NOT NULL,
	"live" boolean DEFAULT false NOT NULL,
	"sample" boolean DEFAULT false NOT NULL,
	"next_poll_at" timestamp with time zone,
	"poll_failures" integer DEFAULT 0 NOT NULL,
	"deposit_seen_at" timestamp with time zone,
	"settled_at" timestamp with time zone,
	"refunded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payouts" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"state" text NOT NULL,
	"asset" text NOT NULL,
	"amount_base" numeric(78, 0) NOT NULL,
	"receive_asset" text NOT NULL,
	"receive_base" numeric(78, 0) NOT NULL,
	"min_receive_base" numeric(78, 0) NOT NULL,
	"usd" numeric(18, 6) NOT NULL,
	"fee_usd" numeric(18, 6) DEFAULT '0' NOT NULL,
	"destination_id" text NOT NULL,
	"destination_label" text NOT NULL,
	"destination_address" text NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"payment_count" integer DEFAULT 0 NOT NULL,
	"signer" text NOT NULL,
	"deposit_address" text,
	"deposit_memo" text,
	"quote" jsonb,
	"quote_signature" text,
	"intent" jsonb,
	"signature" text,
	"intent_hash" text,
	"sign_expires_at" timestamp with time zone,
	"provider_status" text,
	"destination_tx_hashes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"failure_reason" text,
	"requested_by" text,
	"live" boolean DEFAULT false NOT NULL,
	"sample" boolean DEFAULT false NOT NULL,
	"next_poll_at" timestamp with time zone,
	"poll_failures" integer DEFAULT 0 NOT NULL,
	"submit_attempted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"payment_id" text NOT NULL,
	"kind" text NOT NULL,
	"state" text NOT NULL,
	"asset" text NOT NULL,
	"amount_base" numeric(78, 0) NOT NULL,
	"pay_asset" text NOT NULL,
	"pay_base" numeric(78, 0),
	"usd" numeric(18, 6) NOT NULL,
	"recipient" text NOT NULL,
	"signer" text,
	"deposit_address" text,
	"deposit_memo" text,
	"quote" jsonb,
	"quote_signature" text,
	"intent" jsonb,
	"signature" text,
	"intent_hash" text,
	"sign_expires_at" timestamp with time zone,
	"provider_status" text,
	"tx_hash" text,
	"failure_reason" text,
	"requested_by" text,
	"live" boolean DEFAULT false NOT NULL,
	"next_poll_at" timestamp with time zone,
	"poll_failures" integer DEFAULT 0 NOT NULL,
	"submit_attempted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "route_controls" (
	"key" text PRIMARY KEY NOT NULL,
	"paused" boolean DEFAULT true NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "screened_addresses" (
	"address" text PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"listed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"org_id" text,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_balances" (
	"account" text NOT NULL,
	"asset_id" text NOT NULL,
	"amount" numeric(78, 0) DEFAULT '0' NOT NULL,
	CONSTRAINT "sim_balances_account_asset_id_pk" PRIMARY KEY("account","asset_id")
);
--> statement-breakpoint
CREATE TABLE "sim_swaps" (
	"deposit_address" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"request" jsonb NOT NULL,
	"quote" jsonb NOT NULL,
	"deposited_base" numeric(78, 0),
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_login_at" timestamp with time zone,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "wallet_changes" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"from_wallet" text,
	"to_wallet" text NOT NULL,
	"requested_by" text NOT NULL,
	"message" text NOT NULL,
	"new_wallet_signature" text NOT NULL,
	"current_wallet_signature" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wallet_changes_message_unique" UNIQUE("message")
);
--> statement-breakpoint
CREATE TABLE "webhook_deliveries" (
	"id" text PRIMARY KEY NOT NULL,
	"webhook_id" text NOT NULL,
	"org_id" text NOT NULL,
	"event_id" text NOT NULL,
	"type" text NOT NULL,
	"body" text NOT NULL,
	"state" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"last_status" integer,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"delivered_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "webhooks" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"url" text NOT NULL,
	"events" jsonb NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"secret_enc" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "widgets" (
	"id" text PRIMARY KEY NOT NULL,
	"org_id" text NOT NULL,
	"name" text NOT NULL,
	"site" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"theme" text DEFAULT 'auto' NOT NULL,
	"accent" text NOT NULL,
	"radius" text DEFAULT 'rounded' NOT NULL,
	"amount_usd" numeric(18, 2),
	"receive_asset" text NOT NULL,
	"button_label" text DEFAULT 'Pay' NOT NULL,
	"show_branding" boolean DEFAULT true NOT NULL,
	"accepted_assets" jsonb NOT NULL,
	"presets" jsonb NOT NULL,
	"display_name" text DEFAULT '' NOT NULL,
	"logo" text DEFAULT '' NOT NULL,
	"collect_email" boolean DEFAULT false NOT NULL,
	"success" jsonb NOT NULL,
	"sample" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "destinations" ADD CONSTRAINT "destinations_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invites" ADD CONSTRAINT "invites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_links" ADD CONSTRAINT "payment_links_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_changes" ADD CONSTRAINT "wallet_changes_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_webhooks_id_fk" FOREIGN KEY ("webhook_id") REFERENCES "public"."webhooks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "widgets" ADD CONSTRAINT "widgets_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "api_keys_org_idx" ON "api_keys" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "audit_log_org_idx" ON "audit_log" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "destinations_org_idx" ON "destinations" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "invites_org_idx" ON "invites" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "notifications_org_idx" ON "notifications" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_pending_idx" ON "outbox" USING btree ("id") WHERE "outbox"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "payment_events_payment_idx" ON "payment_events" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "payment_links_org_idx" ON "payment_links" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_idx" ON "payments" USING btree ("source_id","idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_deposit_idx" ON "payments" USING btree ("deposit_address","deposit_memo");--> statement-breakpoint
CREATE INDEX "payments_org_created_idx" ON "payments" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "payments_org_updated_idx" ON "payments" USING btree ("org_id","updated_at");--> statement-breakpoint
CREATE INDEX "payments_poll_idx" ON "payments" USING btree ("next_poll_at") WHERE "payments"."next_poll_at" is not null;--> statement-breakpoint
CREATE INDEX "payouts_org_created_idx" ON "payouts" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "payouts_poll_idx" ON "payouts" USING btree ("next_poll_at") WHERE "payouts"."next_poll_at" is not null;--> statement-breakpoint
CREATE INDEX "rate_limits_window_idx" ON "rate_limits" USING btree ("window_start");--> statement-breakpoint
CREATE INDEX "refunds_org_idx" ON "refunds" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "refunds_payment_idx" ON "refunds" USING btree ("payment_id");--> statement-breakpoint
CREATE INDEX "refunds_poll_idx" ON "refunds" USING btree ("next_poll_at") WHERE "refunds"."next_poll_at" is not null;--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "wallet_changes_org_idx" ON "wallet_changes" USING btree ("org_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_deliveries_unique_idx" ON "webhook_deliveries" USING btree ("webhook_id","event_id");--> statement-breakpoint
CREATE INDEX "webhook_deliveries_due_idx" ON "webhook_deliveries" USING btree ("next_attempt_at") WHERE "webhook_deliveries"."state" = 'pending';--> statement-breakpoint
CREATE INDEX "webhook_deliveries_org_idx" ON "webhook_deliveries" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "webhooks_org_idx" ON "webhooks" USING btree ("org_id");--> statement-breakpoint
CREATE INDEX "widgets_org_idx" ON "widgets" USING btree ("org_id");