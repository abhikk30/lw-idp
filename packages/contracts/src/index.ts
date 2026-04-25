// Re-export all generated protobuf types and service descriptors for consumers.
// Note: protoc-gen-es v2 generates GenService objects directly in _pb.ts,
// which are natively compatible with @connectrpc/connect v2 (createClient / connectNodeAdapter).
//
// Namespace exports prevent name collisions across services (e.g. Service, Cluster, etc.).
export * as identity from "../dist/proto/lwidp/identity/v1/identity_pb.js";
export * as catalog from "../dist/proto/lwidp/catalog/v1/catalog_pb.js";
export * as cluster from "../dist/proto/lwidp/cluster/v1/cluster_pb.js";

// Shared Zod form schemas (UI projection of OpenAPI create/register payloads).
export * from "./forms/index.js";
