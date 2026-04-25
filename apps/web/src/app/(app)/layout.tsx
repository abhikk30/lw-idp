import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell } from "../../components/app-shell.client.js";
import { getServerSession } from "../../lib/auth/server.js";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
}: {
  children: ReactNode;
}): Promise<ReactNode> {
  const session = await getServerSession();
  if (!session) {
    redirect("/auth/login");
  }
  return (
    <AppShell user={{ displayName: session.user.displayName, email: session.user.email }}>
      {children}
    </AppShell>
  );
}
