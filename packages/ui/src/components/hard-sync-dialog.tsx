"use client";

import type { ReactNode } from "react";
import { Button } from "./button.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "./dialog.js";

export interface HardSyncDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  applicationName: string;
  onConfirm: () => void;
  /** When true, disables both buttons (e.g. mutation in flight). */
  busy?: boolean;
}

/**
 * Confirmation dialog for the destructive Hard Sync action on the deployments
 * panel. Hard Sync = `prune: true, force: true` which can delete cluster
 * resources removed from Git AND force-apply on conflicts.
 *
 * P2.0 spec §4.8: Hard Sync MUST be gated behind a confirm dialog (the user
 * confirmed this preference during brainstorming, 2026-04-27).
 *
 * Wrapper around Radix Dialog primitive — no separate AlertDialog component
 * exists in the design system today. Destructive intent is expressed via
 * `variant="destructive"` on the confirm button.
 */
export function HardSyncDialog({
  open,
  onOpenChange,
  applicationName,
  onConfirm,
  busy = false,
}: HardSyncDialogProps): ReactNode {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Hard Sync — {applicationName}</DialogTitle>
          <DialogDescription>
            Hard Sync will <strong>prune</strong> resources that exist in the cluster but not in
            Git, and <strong>force-apply</strong> on conflicts. Resources removed from{" "}
            <code>charts/{applicationName}/</code> on master will be deleted from the cluster.
            Continue?
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={busy}>
            {busy ? "Syncing…" : "Hard Sync"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
