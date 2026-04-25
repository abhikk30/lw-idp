"use client";

import { Button } from "@lw-idp/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@lw-idp/ui/components/dropdown-menu";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@lw-idp/ui/components/sheet";
import type { ReactNode } from "react";
import { SidebarNav } from "./sidebar.client.js";
import { ThemeToggle } from "./theme-toggle.client.js";

export interface TopbarProps {
  user: { displayName: string; email: string };
}

export function Topbar({ user }: TopbarProps): ReactNode {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-border bg-background/95 px-4 backdrop-blur supports-[backdrop-filter]:bg-background/80">
      {/* Mobile: side-sheet trigger */}
      <div className="md:hidden">
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" aria-label="Open navigation">
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth={2}
                className="h-4 w-4"
              >
                <title>Menu</title>
                <path d="M2 4h12M2 8h12M2 12h12" strokeLinecap="round" />
              </svg>
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <SheetHeader className="px-4 pt-4">
              <SheetTitle>Navigation</SheetTitle>
            </SheetHeader>
            <div className="pt-2">
              <SidebarNav />
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Spacer pushes user menu right */}
      <div className="flex-1" />

      <ThemeToggle />

      {/* C3 will replace this slot with the real <CommandPaletteTrigger />. */}
      <div data-slot="command-palette" aria-hidden />

      {/* User dropdown */}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" className="ml-1" aria-label="User menu">
            {user.displayName}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <DropdownMenuLabel>
            <div className="text-sm font-medium leading-none">{user.displayName}</div>
            <div className="text-muted-foreground mt-1 text-xs leading-none">{user.email}</div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <DropdownMenuItem asChild>
            <a href="/settings/profile">Profile</a>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <form action="/auth/logout" method="post" className="w-full">
              <button type="submit" className="w-full text-left">
                Sign out
              </button>
            </form>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </header>
  );
}
