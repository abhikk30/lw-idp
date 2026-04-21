-- Add a generated tsvector column for full-text search over name + description + slug
-- Drizzle can't model generated columns natively, so we express it in raw SQL.
ALTER TABLE "services" ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    setweight(to_tsvector('english', coalesce(name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(description, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(slug, '')), 'A')
  ) STORED;

CREATE INDEX IF NOT EXISTS "services_search_vector_idx" ON "services" USING GIN ("search_vector");
