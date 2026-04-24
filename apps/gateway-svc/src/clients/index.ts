export * from "./identity.js";
export * from "./catalog.js";
export * from "./cluster.js";

import { type CatalogClient, createCatalogClient } from "./catalog.js";
import { type ClusterClient, createClusterClient } from "./cluster.js";
import { type IdentityClient, createIdentityClient } from "./identity.js";

export interface UpstreamClients {
  identity: IdentityClient;
  catalog: CatalogClient;
  cluster: ClusterClient;
}

export interface UpstreamUrls {
  identityUrl: string;
  catalogUrl: string;
  clusterUrl: string;
}

export function createUpstreamClients(urls: UpstreamUrls): UpstreamClients {
  return {
    identity: createIdentityClient(urls.identityUrl),
    catalog: createCatalogClient(urls.catalogUrl),
    cluster: createClusterClient(urls.clusterUrl),
  };
}
