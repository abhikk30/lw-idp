import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import type { NotificationService } from "@lw-idp/contracts/notification/v1";

/**
 * Deps reserved for future P1.7 work — keep the type so plugin.ts stays stable.
 * Real ListRecent/MarkRead implementations will need a Postgres handle, etc.
 */
export type NotificationServiceDeps = Record<string, never>;

/**
 * P1.6 ships proto stability only — both RPCs return Unimplemented.
 * Real implementations land with P1.7 web portal work.
 */
export function makeNotificationServiceImpl(
  _deps: NotificationServiceDeps = {},
): ServiceImpl<typeof NotificationService> {
  return {
    async listRecent() {
      throw new ConnectError(
        "ListRecent is not implemented in P1.6 — lands with web portal in P1.7",
        Code.Unimplemented,
      );
    },

    async markRead() {
      throw new ConnectError(
        "MarkRead is not implemented in P1.6 — lands with web portal in P1.7",
        Code.Unimplemented,
      );
    },
  };
}
