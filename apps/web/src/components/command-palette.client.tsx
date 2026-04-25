"use client";

import { Button } from "@lw-idp/ui/components/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@lw-idp/ui/components/command";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@lw-idp/ui/components/dialog";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useUiStore } from "../store/ui.js";

interface PaletteAction {
  id: string;
  label: string;
  hint?: string;
  run: (
    router: ReturnType<typeof useRouter>,
    store: ReturnType<typeof useUiStore.getState>,
  ) => void;
}

const ACTIONS: PaletteAction[] = [
  { id: "nav.dashboard", label: "Go to Dashboard", run: (r) => r.push("/") },
  { id: "nav.services", label: "Go to Services", run: (r) => r.push("/services") },
  { id: "nav.services.new", label: "New Service", run: (r) => r.push("/services/new") },
  { id: "nav.clusters", label: "Go to Clusters", run: (r) => r.push("/clusters") },
  { id: "nav.clusters.new", label: "Register Cluster", run: (r) => r.push("/clusters/new") },
  { id: "nav.teams", label: "Go to Teams", run: (r) => r.push("/teams") },
  { id: "nav.profile", label: "Go to Profile", run: (r) => r.push("/settings/profile") },
  {
    id: "theme.toggle",
    label: "Toggle theme",
    run: (_, store) => store.toggleTheme(),
  },
];

export function CommandPalette(): React.ReactNode {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  // ⌘K / Ctrl+K opens the palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const handleSelect = (id: string): void => {
    const action = ACTIONS.find((a) => a.id === id);
    if (!action) {
      return;
    }
    action.run(router, useUiStore.getState());
    setOpen(false);
  };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => setOpen(true)}
        aria-label="Open command palette"
        className="hidden h-8 gap-2 px-2 sm:flex"
      >
        <span className="text-muted-foreground text-xs">⌘K</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="overflow-hidden p-0">
          <DialogTitle className="sr-only">Command palette</DialogTitle>
          <DialogDescription className="sr-only">
            Search for navigation targets and preferences. Use arrow keys to move and Enter to
            select.
          </DialogDescription>
          <Command label="Command palette">
            <CommandInput placeholder="Type a command or jump to a page…" />
            <CommandList>
              <CommandEmpty>No matches.</CommandEmpty>
              <CommandGroup heading="Navigation">
                {ACTIONS.filter((a) => a.id.startsWith("nav.")).map((a) => (
                  <CommandItem key={a.id} value={a.label} onSelect={() => handleSelect(a.id)}>
                    {a.label}
                  </CommandItem>
                ))}
              </CommandGroup>
              <CommandGroup heading="Preferences">
                {ACTIONS.filter((a) => !a.id.startsWith("nav.")).map((a) => (
                  <CommandItem key={a.id} value={a.label} onSelect={() => handleSelect(a.id)}>
                    {a.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
