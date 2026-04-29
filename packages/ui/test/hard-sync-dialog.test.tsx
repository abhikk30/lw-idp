import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HardSyncDialog } from "../src/components/hard-sync-dialog.js";

afterEach(cleanup);

function Harness({
  initialOpen = true,
  busy = false,
  onConfirm = vi.fn(),
  onOpenChange,
}: {
  initialOpen?: boolean;
  busy?: boolean;
  onConfirm?: () => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(initialOpen);
  return (
    <HardSyncDialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        onOpenChange?.(v);
      }}
      applicationName="catalog-svc"
      onConfirm={onConfirm}
      busy={busy}
    />
  );
}

describe("HardSyncDialog", () => {
  it("renders title with application name when open", () => {
    render(<Harness />);
    expect(screen.getByRole("heading", { name: /Hard Sync — catalog-svc/i })).toBeInTheDocument();
  });

  it("explains the destructive prune + force-apply semantics", () => {
    render(<Harness />);
    // Description text is split across <strong> and <code> elements and the
    // prune word appears in two places (the bold callout + the explanatory
    // sentence below). Assert at least one of each appears.
    expect(screen.getAllByText(/prune/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/force-apply/i).length).toBeGreaterThan(0);
  });

  it("Cancel button closes the dialog without invoking onConfirm", () => {
    const onConfirm = vi.fn();
    const onOpenChange = vi.fn();
    render(<Harness onConfirm={onConfirm} onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: /Cancel/i }));

    expect(onConfirm).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
  });

  it("Hard Sync button invokes onConfirm exactly once", () => {
    const onConfirm = vi.fn();
    render(<Harness onConfirm={onConfirm} />);

    fireEvent.click(screen.getByRole("button", { name: /^Hard Sync$/i }));

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("when busy=true, both buttons are disabled and confirm label shows progress", () => {
    const onConfirm = vi.fn();
    render(<Harness busy onConfirm={onConfirm} />);

    const cancel = screen.getByRole("button", { name: /Cancel/i });
    const confirm = screen.getByRole("button", { name: /Syncing…/i });
    expect(cancel).toBeDisabled();
    expect(confirm).toBeDisabled();

    fireEvent.click(confirm);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("renders no dialog content when open=false", () => {
    render(<Harness initialOpen={false} />);
    // Radix unmounts the Dialog content when closed; querying by role="dialog"
    // is the canonical way to assert it's gone (the heading regex would also
    // match the button's "Hard Sync" label, which is misleading).
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
