"use client";

import type { ReactNode } from "react";
import { EventStreamProvider } from "./event-stream-provider.client.js";
import { Sidebar } from "./sidebar.client.js";
import { Topbar } from "./topbar.client.js";

export interface AppShellProps {
  children: ReactNode;
  user: { displayName: string; email: string };
}

export function AppShell({ children, user }: AppShellProps): ReactNode {
  return (
    <EventStreamProvider>
      <div className="flex min-h-screen bg-background">
        <Sidebar />
        <div className="flex min-h-screen flex-1 flex-col">
          <Topbar user={user} />
          <main className="flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-screen-2xl p-6">{children}</div>
          </main>
        </div>
      </div>
    </EventStreamProvider>
  );
}
