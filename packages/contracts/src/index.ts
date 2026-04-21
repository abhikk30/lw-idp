// Re-export all generated protobuf types and service descriptors for consumers.
// Note: protoc-gen-es v2 generates GenService objects directly in _pb.ts,
// which are natively compatible with @connectrpc/connect v2 (createClient / connectNodeAdapter).
export * from "../dist/proto/lwidp/identity/v1/identity_pb.js";
