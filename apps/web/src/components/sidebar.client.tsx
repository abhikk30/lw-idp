"use client";

import { cn } from "@lw-idp/ui/lib/utils";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

interface NavItem {
  href: string;
  label: string;
  /** Match the start of the pathname so /services/[id] highlights "Services". */
  match: string;
}

const NAV: NavItem[] = [
  { href: "/", label: "Dashboard", match: "/" },
  { href: "/services", label: "Services", match: "/services" },
  { href: "/clusters", label: "Clusters", match: "/clusters" },
  { href: "/teams", label: "Teams", match: "/teams" },
  { href: "/security", label: "Security", match: "/security" },
  { href: "/settings/profile", label: "Settings", match: "/settings" },
];

/**
 * Inner nav (no aside wrapper). Used both by the desktop `<Sidebar>` and by
 * the mobile `<SheetContent>` so we don't double-render hidden-on-mobile CSS.
 */
export function SidebarNav(): ReactNode {
  // usePathname() returns null when rendered outside an App Router context
  // (e.g. in unit tests). Default to empty string so prefix matching still
  // works without throwing.
  const pathname = usePathname() ?? "";
  return (
    <nav className="flex-1 px-3 pb-3" aria-label="Main">
      <ul className="flex flex-col gap-1">
        {NAV.map((item) => {
          const active =
            item.match === "/"
              ? pathname === "/"
              : pathname === item.match || pathname.startsWith(`${item.match}/`);
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  active
                    ? "bg-accent text-accent-foreground"
                    : "text-muted-foreground hover:bg-accent/40 hover:text-accent-foreground",
                )}
              >
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function Sidebar(): ReactNode {
  return (
    <aside
      className="hidden w-56 shrink-0 flex-col border-r border-border bg-card md:flex"
      aria-label="Primary"
    >
      <div className="flex h-14 items-center px-4">
        <Link href="/" className="font-semibold tracking-tight">
          lw-idp
        </Link>
      </div>
      <SidebarNav />
    </aside>
  );
}
