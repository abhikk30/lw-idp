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
});

export type ServiceCreateInput = z.infer<typeof serviceCreateSchema>;
