import type { ReactNode } from "react";
import { SecurityClusterPage } from "../../../components/security/cluster-page.client.js";

export const dynamic = "force-dynamic";

export default async function SecurityPage(): Promise<ReactNode> {
  return <SecurityClusterPage />;
}
