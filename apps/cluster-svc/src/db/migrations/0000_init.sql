CREATE TYPE "environment" AS ENUM ('dev', 'stage', 'prod');
CREATE TYPE "provider" AS ENUM ('docker-desktop', 'eks', 'gke', 'aks', 'kind', 'other');

CREATE TABLE IF NOT EXISTS "clusters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "slug" text NOT NULL,
  "name" text NOT NULL,
  "environment" environment NOT NULL DEFAULT 'dev',
  "region" text NOT NULL DEFAULT '',
  "provider" provider NOT NULL DEFAULT 'other',
  "api_endpoint" text NOT NULL DEFAULT '',
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "clusters_slug_unique" ON "clusters" ("slug");

CREATE TABLE IF NOT EXISTS "cluster_tags" (
  "cluster_id" uuid NOT NULL REFERENCES "clusters"("id") ON DELETE CASCADE,
  "tag" text NOT NULL,
  PRIMARY KEY ("cluster_id", "tag")
);
CREATE INDEX IF NOT EXISTS "cluster_tags_tag_idx" ON "cluster_tags" ("tag");

CREATE TABLE IF NOT EXISTS "outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "aggregate" text NOT NULL,
  "event_type" text NOT NULL,
  "payload" jsonb NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "published_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "outbox_unpublished_idx" ON "outbox" ("created_at") WHERE "published_at" IS NULL;
