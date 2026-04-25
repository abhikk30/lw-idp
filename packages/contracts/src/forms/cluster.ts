import { z } from "zod";

export const clusterEnvironmentEnum = z.enum(["dev", "stage", "prod"]);
export const clusterProviderEnum = z.enum(["docker-desktop", "eks", "gke", "aks", "kind", "other"]);

const slugSchema = z
  .string()
  .min(1, "Slug is required")
  .max(64, "Slug must be 64 characters or fewer")
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Use lowercase letters, numbers, and dashes");

export const clusterRegisterSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1, "Name is required").max(128),
  environment: clusterEnvironmentEnum,
  region: z.string().min(1, "Region is required").max(64),
  provider: clusterProviderEnum,
  apiEndpoint: z.string().url("Must be a valid URL").startsWith("https://", "Must use HTTPS"),
});

export type ClusterRegisterInput = z.infer<typeof clusterRegisterSchema>;
