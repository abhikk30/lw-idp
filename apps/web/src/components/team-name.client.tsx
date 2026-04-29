"use client";

import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { apiClient } from "../lib/api/client.js";

/**
 * Render a team's friendly name given its UUID.
 *
 * Looks the team up in the current user's `/me` payload (which includes their
 * team memberships). If the team isn't found there, falls back to a short
 * `team:abcd1234` placeholder rather than the full UUID.
 *
 * P2.0.6 deviation: this only resolves names for teams the current user is in.
 * A proper fix would have catalog-svc.GetService join with identity-svc and
 * return `ownerTeam: { id, slug, name }` in the response — that lets us show
 * names for ALL teams, not just the user's own.
 */
export function TeamName({ id }: { id: string }): ReactNode {
  const { data } = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      const { data } = await apiClient().GET("/me", {});
      return data;
    },
    staleTime: 5 * 60_000,
  });
  const team = data?.teams?.find((t) => t.id === id);
  if (team) {
    return (
      <span className="text-sm">
        <span>{team.name}</span>
        <span className="text-muted-foreground ml-2 font-mono text-xs">@{team.slug}</span>
      </span>
    );
  }
  return <span className="text-muted-foreground font-mono text-xs">team:{id.slice(0, 8)}</span>;
}
