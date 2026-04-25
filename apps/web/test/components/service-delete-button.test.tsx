import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Toaster } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ServiceDeleteButton } from "../../src/components/services/service-delete-button.client.js";

afterEach(cleanup);

describe("ServiceDeleteButton", () => {
  it("opens dialog on click; cancels without calling action", async () => {
    const action = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <ServiceDeleteButton id="svc-1" name="Checkout" deleteAction={action} />
        <Toaster />
      </>,
    );
    await user.click(screen.getByRole("button", { name: /delete service/i }));
    expect(screen.getByText(/this action cannot be undone/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(action).not.toHaveBeenCalled();
  });

  it("confirms — calls deleteAction; toast on success", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    const user = userEvent.setup();
    render(
      <>
        <ServiceDeleteButton id="svc-1" name="Checkout" deleteAction={action} />
        <Toaster />
      </>,
    );
    await user.click(screen.getByRole("button", { name: /delete service/i }));
    await user.click(screen.getByRole("button", { name: /yes, delete/i }));
    await waitFor(() => {
      expect(action).toHaveBeenCalled();
    });
    await waitFor(() => {
      expect(screen.getByText(/checkout.*deleted/i)).toBeInTheDocument();
    });
  });

  it("shows toast on action failure", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, message: "Forbidden" });
    const user = userEvent.setup();
    render(
      <>
        <ServiceDeleteButton id="svc-1" name="Checkout" deleteAction={action} />
        <Toaster />
      </>,
    );
    await user.click(screen.getByRole("button", { name: /delete service/i }));
    await user.click(screen.getByRole("button", { name: /yes, delete/i }));
    await waitFor(() => {
      expect(screen.getByText(/forbidden/i)).toBeInTheDocument();
    });
  });
});
