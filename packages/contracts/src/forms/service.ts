import { z } from "zod";

export const serviceTypeEnum = z.enum(["service", "library", "website", "ml", "job"]);
export const serviceLifecycleEnum = z.enum(["experimental", "production", "deprecated"]);

const slugSchema = z
  .string()
  .min(1, "Slug is required")
  .max(64, "Slug must be 64 characters or fewer")
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/, "Use lowercase letters, numbers, and dashes");

export const serviceCreateSchema = z.object({
  slug: slugSchema,
  name: z.string().min(1, "Name is required").max(128),
  description: z.string().max(2000).optional(),
  type: serviceTypeEnum,
  lifecycle: serviceLifecycleEnum,
  ownerTeamId: z.string().uuid("Must be a valid team UUID"),
  repoUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  tags: z.array(z.string().min(1).max(32)).max(10).optional(),
  // Optional Argo CD Application fields. `gitRepoUrl` is the toggle: when set,
  // the form's submit handler also POSTs an Argo CD Application after the
  // catalog row is created. The other three are auto-defaulted server-side at
  // submit time (branch=master, chartPath=charts/${slug}, namespace=lw-idp) so
  // they remain optional individually.
  gitRepoUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
  gitBranch: z.string().max(255).optional().or(z.literal("")),
  chartPath: z.string().max(255).optional().or(z.literal("")),
  targetNamespace: z.string().max(63).optional().or(z.literal("")),
});

export type ServiceCreateInput = z.infer<typeof serviceCreateSchema>;
