import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@lw-idp/ui/components/card";
import type { ReactNode } from "react";
import { getServerSession } from "../../../../lib/auth/server.js";

export const dynamic = "force-dynamic";

export default async function ProfilePage(): Promise<ReactNode> {
  const session = await getServerSession();
  if (!session) {
    // (app) layout already redirects unauth, but defensive.
    return <p className="text-muted-foreground">No session.</p>;
  }
  const { user, teams } = session;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
        <p className="text-muted-foreground mt-1 text-sm">Your lw-idp identity.</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{user.displayName}</CardTitle>
          <CardDescription>{user.email}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <Field label="User ID">
            <code className="text-xs">{user.id}</code>
          </Field>
          <Field label="Subject">
            <code className="font-mono text-xs">{user.subject}</code>
          </Field>
          <Field label="Teams">
            {teams.length === 0 ? (
              <span className="text-muted-foreground text-sm italic">No teams.</span>
            ) : (
              <ul className="flex flex-wrap gap-1">
                {teams.map((t) => (
                  <li
                    key={t.id}
                    className="bg-secondary text-secondary-foreground rounded-md px-2 py-1 text-xs"
                  >
                    {t.name}
                  </li>
                ))}
              </ul>
            )}
          </Field>
        </CardContent>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }): ReactNode {
  return (
    <div className="grid grid-cols-[8rem_1fr] items-start gap-2">
      <span className="text-muted-foreground text-sm">{label}</span>
      <div>{children}</div>
    </div>
  );
}
