"use client";

import { Tabs, TabsList, TabsTrigger } from "@lw-idp/ui/components/tabs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

export interface ServiceTabsProps {
  id: string;
}

export function ServiceTabs({ id }: ServiceTabsProps): ReactNode {
  const pathname = usePathname() ?? "";
  let active = "overview";
  if (pathname.endsWith("/deployments")) {
    active = "deployments";
  } else if (pathname.endsWith("/builds")) {
    active = "builds";
  } else if (pathname.endsWith("/pipelines")) {
    active = "pipelines";
  } else if (pathname.endsWith("/security")) {
    active = "security";
  } else if (pathname.endsWith("/settings")) {
    active = "settings";
  }

  return (
    <Tabs value={active}>
      <TabsList>
        <TabsTrigger value="overview" asChild>
          <Link href={`/services/${id}`}>Overview</Link>
        </TabsTrigger>
        <TabsTrigger value="deployments" asChild>
          <Link href={`/services/${id}/deployments`}>Deployments</Link>
        </TabsTrigger>
        <TabsTrigger value="builds" asChild>
          <Link href={`/services/${id}/builds`}>Builds</Link>
        </TabsTrigger>
        <TabsTrigger value="pipelines" asChild>
          <Link href={`/services/${id}/pipelines`}>Pipelines</Link>
        </TabsTrigger>
        <TabsTrigger value="security" asChild>
          <Link href={`/services/${id}/security`}>Security</Link>
        </TabsTrigger>
        <TabsTrigger value="settings" asChild>
          <Link href={`/services/${id}/settings`}>Settings</Link>
        </TabsTrigger>
      </TabsList>
    </Tabs>
  );
}
