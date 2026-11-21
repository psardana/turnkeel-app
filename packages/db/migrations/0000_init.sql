CREATE TABLE "account" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" uuid NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp,
	"refresh_token_expires_at" timestamp,
	"scope" text,
	"password" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "event_counters" (
	"workspace_id" uuid PRIMARY KEY NOT NULL,
	"last_seq" bigint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"project_id" uuid,
	"at" timestamp with time zone NOT NULL,
	"actor_kind" text NOT NULL,
	"actor_id" uuid NOT NULL,
	"actor_name" text NOT NULL,
	"via" text NOT NULL,
	"token_id" uuid,
	"session_id" uuid,
	"request_id" uuid NOT NULL,
	"type" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"subject_owner_kind" text,
	"subject_owner_id" uuid,
	"data" jsonb NOT NULL,
	CONSTRAINT "events_seq_check" CHECK ("events"."seq" > 0),
	CONSTRAINT "events_actor_kind_check" CHECK ("events"."actor_kind" in ('user', 'agent', 'system')),
	CONSTRAINT "events_via_check" CHECK ("events"."via" in ('web', 'rest', 'mcp', 'cli', 'hook', 'connector', 'job'))
);
--> statement-breakpoint
CREATE TABLE "idempotency_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"principal_kind" text NOT NULL,
	"principal_id" uuid NOT NULL,
	"token_id" uuid,
	"key" text NOT NULL,
	"scope" text NOT NULL,
	"request_hash" text NOT NULL,
	"response" jsonb NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "idempotency_records_principal_kind_check" CHECK ("idempotency_records"."principal_kind" in ('user', 'agent', 'system'))
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" text NOT NULL,
	"project_id" uuid,
	"token_hash" text NOT NULL,
	"invited_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"created_by_kind" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by_kind" text NOT NULL,
	"updated_by_id" uuid NOT NULL,
	CONSTRAINT "invitations_role_check" CHECK ("invitations"."role" in ('owner', 'admin', 'member', 'reviewer', 'tester', 'viewer')),
	CONSTRAINT "invitations_role_project_check" CHECK (("invitations"."project_id" is null and "invitations"."role" <> 'tester') or ("invitations"."project_id" is not null and "invitations"."role" not in ('owner', 'admin')))
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"handle" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by_kind" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by_kind" text NOT NULL,
	"updated_by_id" uuid NOT NULL,
	CONSTRAINT "members_role_check" CHECK ("members"."role" in ('owner', 'admin', 'member', 'reviewer', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "passkey" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text,
	"public_key" text NOT NULL,
	"user_id" uuid NOT NULL,
	"credential_id" text NOT NULL,
	"counter" integer NOT NULL,
	"device_type" text NOT NULL,
	"backed_up" boolean NOT NULL,
	"transports" text,
	"created_at" timestamp,
	"aaguid" text
);
--> statement-breakpoint
CREATE TABLE "project_members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"project_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"created_by_kind" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by_kind" text NOT NULL,
	"updated_by_id" uuid NOT NULL,
	CONSTRAINT "project_members_role_check" CHECK ("project_members"."role" in ('member', 'reviewer', 'tester', 'viewer'))
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text NOT NULL,
	"launch_date" date,
	"locales" text[] DEFAULT ARRAY['en']::text[] NOT NULL,
	"repo_url" text,
	"changelog_public" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"created_by_kind" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by_kind" text NOT NULL,
	"updated_by_id" uuid NOT NULL,
	CONSTRAINT "projects_kind_check" CHECK ("projects"."kind" in ('app', 'web', 'extension', 'library', 'other'))
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"expires_at" timestamp NOT NULL,
	"token" text NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" uuid NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid() NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"base_currency" text NOT NULL,
	"demo" boolean DEFAULT false NOT NULL,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"created_by_kind" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by_kind" text NOT NULL,
	"updated_by_id" uuid NOT NULL,
	CONSTRAINT "workspaces_created_by_kind_check" CHECK ("workspaces"."created_by_kind" in ('user', 'agent', 'system')),
	CONSTRAINT "workspaces_updated_by_kind_check" CHECK ("workspaces"."updated_by_kind" in ('user', 'agent', 'system'))
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_counters" ADD CONSTRAINT "event_counters_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_invited_by_user_id_fk" FOREIGN KEY ("invited_by") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "passkey" ADD CONSTRAINT "passkey_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_userId_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "events_workspace_seq_key" ON "events" USING btree ("workspace_id","seq");--> statement-breakpoint
CREATE INDEX "events_workspace_subject_idx" ON "events" USING btree ("workspace_id","subject_type","subject_id","seq");--> statement-breakpoint
CREATE INDEX "events_workspace_project_idx" ON "events" USING btree ("workspace_id","project_id","seq");--> statement-breakpoint
CREATE INDEX "events_workspace_actor_idx" ON "events" USING btree ("workspace_id","actor_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_records_principal_scope_key_key" ON "idempotency_records" USING btree ("principal_kind","principal_id","scope","key");--> statement-breakpoint
CREATE INDEX "idempotency_records_expires_at_idx" ON "idempotency_records" USING btree ("expires_at");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "invitations_workspace_email_lower_idx" ON "invitations" USING btree ("workspace_id",lower("email"));--> statement-breakpoint
CREATE INDEX "invitations_email_lower_idx" ON "invitations" USING btree (lower("email"));--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_open_key" ON "invitations" USING btree ("workspace_id",coalesce("project_id", '00000000-0000-0000-0000-000000000000'::uuid),lower("email")) WHERE "invitations"."accepted_at" is null and "invitations"."revoked_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "members_workspace_user_key" ON "members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "members_workspace_handle_lower_key" ON "members" USING btree ("workspace_id",lower("handle"));--> statement-breakpoint
CREATE INDEX "members_user_idx" ON "members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_userId_idx" ON "passkey" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "passkey_credentialID_idx" ON "passkey" USING btree ("credential_id");--> statement-breakpoint
CREATE UNIQUE INDEX "project_members_project_user_key" ON "project_members" USING btree ("project_id","user_id");--> statement-breakpoint
CREATE INDEX "project_members_workspace_user_idx" ON "project_members" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "project_members_user_idx" ON "project_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_key_lower_key" ON "projects" USING btree ("workspace_id",lower("key"));--> statement-breakpoint
CREATE UNIQUE INDEX "projects_workspace_slug_lower_key" ON "projects" USING btree ("workspace_id",lower("slug"));--> statement-breakpoint
CREATE INDEX "session_userId_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_email_lower_key" ON "user" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE UNIQUE INDEX "workspaces_slug_lower_key" ON "workspaces" USING btree (lower("slug"));