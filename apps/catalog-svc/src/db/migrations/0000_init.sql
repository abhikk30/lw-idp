CREATE TYPE "public"."service_type" AS ENUM('service', 'library', 'website', 'ml', 'job');--> statement-breakpoint
CREATE TYPE "public"."lifecycle" AS ENUM('experimental', 'production', 'deprecated');--> statement-breakpoint
CREATE TYPE "public"."dependency_kind" AS ENUM('uses', 'provides', 'consumes');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "services" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"type" "service_type" DEFAULT 'service' NOT NULL,
	"lifecycle" "lifecycle" DEFAULT 'experimental' NOT NULL,
	"owner_team_id" uuid,
	"repo_url" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_tags" (
	"service_id" uuid NOT NULL,
	"tag" text NOT NULL,
	CONSTRAINT "service_tags_service_id_tag_pk" PRIMARY KEY("service_id","tag")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_dependencies" (
	"service_id" uuid NOT NULL,
	"depends_on_service_id" uuid NOT NULL,
	"kind" "dependency_kind" DEFAULT 'uses' NOT NULL,
	CONSTRAINT "service_dependencies_service_id_depends_on_service_id_kind_pk" PRIMARY KEY("service_id","depends_on_service_id","kind")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "service_metadata" (
	"service_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value_json" jsonb NOT NULL,
	CONSTRAINT "service_metadata_service_id_key_pk" PRIMARY KEY("service_id","key")
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_tags" ADD CONSTRAINT "service_tags_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_dependencies" ADD CONSTRAINT "service_dependencies_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_dependencies" ADD CONSTRAINT "service_dependencies_depends_on_service_id_services_id_fk" FOREIGN KEY ("depends_on_service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "service_metadata" ADD CONSTRAINT "service_metadata_service_id_services_id_fk" FOREIGN KEY ("service_id") REFERENCES "public"."services"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "services_slug_unique" ON "services" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "services_lifecycle_idx" ON "services" USING btree ("lifecycle");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "services_owner_idx" ON "services" USING btree ("owner_team_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "service_tags_tag_idx" ON "service_tags" USING btree ("tag");
