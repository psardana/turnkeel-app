CREATE TABLE "agent_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"agent_id" uuid NOT NULL,
	"name" text NOT NULL,
	"prefix" text NOT NULL,
	"hash" text NOT NULL,
	"scopes" text[] NOT NULL,
	"project_ids" uuid[] NOT NULL,
	"workspace_wide" boolean DEFAULT false NOT NULL,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"created_by_kind" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by_kind" text NOT NULL,
	"updated_by_id" uuid NOT NULL,
	CONSTRAINT "agent_tokens_project_ids_check" CHECK (cardinality("agent_tokens"."project_ids") > 0),
	CONSTRAINT "agent_tokens_scopes_check" CHECK (cardinality("agent_tokens"."scopes") > 0)
);
--> statement-breakpoint
CREATE TABLE "agents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"disabled_at" timestamp with time zone,
	"created_at" timestamp with time zone NOT NULL,
	"created_by_kind" text NOT NULL,
	"created_by_id" uuid NOT NULL,
	"updated_at" timestamp with time zone NOT NULL,
	"updated_by_kind" text NOT NULL,
	"updated_by_id" uuid NOT NULL,
	CONSTRAINT "agents_kind_check" CHECK ("agents"."kind" in ('claude-code', 'codex', 'cursor', 'script', 'other'))
);
--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tokens" ADD CONSTRAINT "agent_tokens_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agents" ADD CONSTRAINT "agents_owner_user_id_user_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."user"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "agent_tokens_hash_key" ON "agent_tokens" USING btree ("hash");--> statement-breakpoint
CREATE INDEX "agent_tokens_agent_idx" ON "agent_tokens" USING btree ("agent_id");--> statement-breakpoint
CREATE UNIQUE INDEX "agents_workspace_name_lower_key" ON "agents" USING btree ("workspace_id",lower("name"));