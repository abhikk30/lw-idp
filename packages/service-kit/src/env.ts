import type { z } from "zod";

export class EnvValidationError extends Error {
  constructor(
    message: string,
    public readonly issues: z.ZodIssue[],
  ) {
    super(message);
    this.name = "EnvValidationError";
  }
}

/**
 * Parse process.env against a Zod schema. On failure, throws with a formatted
 * list of the offending keys so misconfigured deployments fail loud at boot.
 *
 * @example
 *   const Env = z.object({
 *     PG_DSN: z.string().url(),
 *     PORT: z.coerce.number().int().positive().default(4000),
 *   });
 *   const env = loadEnv(Env);
 */
export function loadEnv<T extends z.ZodTypeAny>(
  schema: T,
  source: NodeJS.ProcessEnv = process.env,
): z.infer<T> {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new EnvValidationError(`Invalid environment:\n${lines}`, parsed.error.issues);
  }
  return parsed.data;
}
