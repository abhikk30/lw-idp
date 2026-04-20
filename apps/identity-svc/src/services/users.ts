import { createEnvelope } from "@lw-idp/events";
import { asc, eq, gt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { type NewUser, type User, outbox, users } from "../db/schema/index.js";

export interface UpsertUserInput {
  subject: string;
  email: string;
  displayName?: string;
  avatarUrl?: string;
}

export async function upsertUserBySubject(
  db: PostgresJsDatabase,
  input: UpsertUserInput,
): Promise<User> {
  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.subject, input.subject))
      .limit(1);

    if (existing) {
      const values: Partial<NewUser> = {
        email: input.email,
        updatedAt: new Date(),
      };
      if (input.displayName !== undefined) {
        values.displayName = input.displayName;
      }
      if (input.avatarUrl !== undefined) {
        values.avatarUrl = input.avatarUrl;
      }

      const [updated] = await tx
        .update(users)
        .set(values)
        .where(eq(users.id, existing.id))
        .returning();
      if (!updated) {
        throw new Error("user update failed");
      }
      return updated;
    }

    const newValues: NewUser = {
      subject: input.subject,
      email: input.email,
    };
    if (input.displayName !== undefined) {
      newValues.displayName = input.displayName;
    }
    if (input.avatarUrl !== undefined) {
      newValues.avatarUrl = input.avatarUrl;
    }

    const [created] = await tx.insert(users).values(newValues).returning();
    if (!created) {
      throw new Error("user insert failed");
    }

    const envelope = createEnvelope({
      type: "idp.identity.user.created",
      source: "identity-svc",
      data: {
        id: created.id,
        subject: created.subject,
        email: created.email,
        displayName: created.displayName ?? undefined,
      },
      actor: { userId: created.id },
    });

    await tx.insert(outbox).values({
      aggregate: "user",
      eventType: envelope.type,
      payload: envelope,
    });

    return created;
  });
}

export async function getUserById(db: PostgresJsDatabase, id: string): Promise<User | undefined> {
  const [row] = await db.select().from(users).where(eq(users.id, id)).limit(1);
  return row;
}

export interface ListUsersResult {
  users: User[];
  nextPageToken: string;
}

export async function listUsers(
  db: PostgresJsDatabase,
  opts: { limit?: number; pageToken?: string },
): Promise<ListUsersResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  let cursor: string | undefined;
  if (opts.pageToken && opts.pageToken.length > 0) {
    try {
      cursor = Buffer.from(opts.pageToken, "base64url").toString("utf8");
    } catch {
      cursor = undefined;
    }
  }

  const rows = await db
    .select()
    .from(users)
    .where(cursor ? gt(users.id, cursor) : undefined)
    .orderBy(asc(users.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const next = hasMore ? Buffer.from(page[page.length - 1]?.id, "utf8").toString("base64url") : "";

  return { users: page, nextPageToken: next };
}
