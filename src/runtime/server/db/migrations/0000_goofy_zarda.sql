CREATE TABLE "iam_client_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"instance_id" text NOT NULL,
	"username" text NOT NULL,
	"email" text NOT NULL,
	"access_token" text NOT NULL,
	"refresh_token" text NOT NULL,
	"access_token_expires_at" bigint NOT NULL,
	"app_id" text NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "iam_client_sessions_instance_id_idx" ON "iam_client_sessions" USING btree ("instance_id");