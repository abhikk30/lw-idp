import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ThemeToggle } from "../../src/components/theme-toggle.client.js";
import { useUiStore } from "../../src/store/ui.js";

beforeEach(() => {
  // Reset store to default + clear localStorage to avoid cross-test bleed.
  localStorage.clear();
  useUiStore.setState({ theme: "dark", sidebarCollapsed: false });
  document.documentElement.dataset.theme = "dark";
});

afterEach(cleanup);

describe("ThemeToggle", () => {
  it("renders toggle button labelled for current theme (dark→light)", () => {
    render(<ThemeToggle />);
    expect(screen.getByRole("button", { name: /switch to light theme/i })).toBeInTheDocument();
  });

  it("clicking the toggle flips theme and html data-theme", () => {
    render(<ThemeToggle />);
    const btn = screen.getByRole("button");
    fireEvent.click(btn);
    expect(useUiStore.getState().theme).toBe("light");
    expect(document.documentElement.dataset.theme).toBe("light");
    fireEvent.click(btn);
    expect(useUiStore.getState().theme).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("persists theme across store re-reads (localStorage roundtrip)", () => {
    render(<ThemeToggle />);
    fireEvent.click(screen.getByRole("button"));
    const persisted = JSON.parse(localStorage.getItem("lw-idp-ui") ?? "{}") as {
      state?: { theme?: string };
    };
    expect(persisted.state?.theme).toBe("light");
  });
});
