import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CommandPalette } from "../../src/components/command-palette.client.js";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => Promise.resolve(),
  }),
}));

beforeEach(() => {
  pushMock.mockReset();
});

afterEach(cleanup);

describe("CommandPalette", () => {
  it("opens via ⌘K and shows command items", async () => {
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", metaKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/type a command/i)).toBeInTheDocument();
    });
    expect(screen.getByText("Go to Services")).toBeInTheDocument();
    expect(screen.getByText("Go to Clusters")).toBeInTheDocument();
  });

  it("clicking a navigation item calls router.push", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    fireEvent.keyDown(window, { key: "k", ctrlKey: true });
    await waitFor(() => screen.getByPlaceholderText(/type a command/i));
    await user.click(screen.getByText("Go to Services"));
    expect(pushMock).toHaveBeenCalledWith("/services");
  });

  it("clicking the trigger button opens the palette", async () => {
    const user = userEvent.setup();
    render(<CommandPalette />);
    await user.click(screen.getByRole("button", { name: /open command palette/i }));
    await waitFor(() => screen.getByPlaceholderText(/type a command/i));
  });
});
