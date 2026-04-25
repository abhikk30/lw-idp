export const subjects = {
  // wildcard for consumers that want every idp.* event
  allWildcard: "idp.>",
  // identity
  identityUserCreated: "idp.identity.user.created",
  identityTeamCreated: "idp.identity.team.created",
  identityTeamMemberAdded: "idp.identity.team.member.added",
  // catalog
  catalogServiceCreated: "idp.catalog.service.created",
  catalogServiceUpdated: "idp.catalog.service.updated",
  catalogServiceDeleted: "idp.catalog.service.deleted",
  // cluster
  clusterRegistered: "idp.cluster.cluster.registered",
  clusterUpdated: "idp.cluster.cluster.updated",
  clusterDeregistered: "idp.cluster.cluster.deregistered",
} as const;

export type Subject = (typeof subjects)[keyof typeof subjects];
