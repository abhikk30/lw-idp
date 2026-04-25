"use client";

import { Button } from "@lw-idp/ui/components/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@lw-idp/ui/components/dialog";
import { type ReactNode, useState, useTransition } from "react";
import { toast } from "sonner";

export interface ServiceDeleteButtonProps {
  id: string;
  name: string;
  /** Server action wired by the page. */
  deleteAction: () => Promise<{ ok: true } | { ok: false; message: string }>;
}

export function ServiceDeleteButton({
  id,
  name,
  deleteAction,
}: ServiceDeleteButtonProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const onConfirm = (): void => {
    startTransition(async () => {
      const result = await deleteAction();
      if (result.ok) {
        toast.success(`Service "${name}" deleted`);
        setOpen(false);
        // server action will redirect; no client navigation needed
      } else {
        toast.error(result.message);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="destructive">Delete service</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete service?</DialogTitle>
          <DialogDescription>
            This will permanently remove <span className="font-mono">{name}</span> ({id}) from the
            catalog. This action cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={onConfirm} disabled={isPending}>
            {isPending ? "Deleting…" : "Yes, delete"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
