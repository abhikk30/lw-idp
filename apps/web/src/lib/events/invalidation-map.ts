import type { QueryKey } from "@tanstack/react-query";

/**
 * Map (entity, action) → TanStack Query keys to invalidate.
 *
 * Driven off the `entity` and `action` fields of the notification-svc frame
 * shape: `{ entity: "service" | "cluster" | "team" | ..., action: "created" | "updated" | "deleted" | ... }`.
 * Keys returned will all be passed to `queryClient.invalidateQueries({ queryKey })`.
 *
 * Returns an empty array for unknown pairs — invalidation is fail-quiet so an
 * unmapped frame doesn't blow away unrelated cached data.
 */
export function invalidationKeysFor(entity: string, action: string): QueryKey[] {
  const e = entity.toLowerCase();
  const a = action.toLowerCase();

  if (e === "service") {
    if (a === "created" || a === "updated" || a === "deleted") {
      return [["services"]];
    }
  }
  if (e === "cluster") {
    if (a === "registered" || a === "updated" || a === "deregistered") {
      return [["clusters"]];
    }
  }
  if (e === "team") {
    if (a === "created" || a === "added") {
      return [["teams"], ["me"]]; // me carries teams snapshot — re-pull
    }
  }
  if (e === "user") {
    if (a === "created") {
      return [["me"]];
    }
  }
  return [];
}

/**
 * Human-readable label for a frame action — used in toast text.
 * Defaults to a capitalized action verb.
 */
export function humanizeFrame(
  entity: string,
  action: string,
  payload?: Record<string, unknown>,
): string {
  const name =
    payload && typeof payload === "object" && "name" in payload && typeof payload.name === "string"
      ? payload.name
      : payload &&
          typeof payload === "object" &&
          "slug" in payload &&
          typeof payload.slug === "string"
        ? payload.slug
        : undefined;

  const subject = name ? `"${name}"` : entity;

  switch (action.toLowerCase()) {
    case "created":
    case "registered":
      return `${capitalize(entity)} ${subject} created`;
    case "updated":
      return `${capitalize(entity)} ${subject} updated`;
    case "deleted":
    case "deregistered":
      return `${capitalize(entity)} ${subject} removed`;
    case "added":
      return `${capitalize(entity)} ${subject} added`;
    default:
      return `${capitalize(entity)} ${action}`;
  }
}

function capitalize(s: string): string {
  if (s.length === 0) {
    return s;
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}
