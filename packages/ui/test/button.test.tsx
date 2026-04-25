import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Button } from "../src/components/button.js";

describe("Button", () => {
  it("renders children", () => {
    render(<Button>Click me</Button>);
    expect(screen.getByRole("button", { name: "Click me" })).toBeInTheDocument();
  });

  it("applies variant class", () => {
    render(<Button variant="destructive">Delete</Button>);
    const btn = screen.getByRole("button", { name: "Delete" });
    expect(btn.className).toMatch(/bg-destructive/);
  });

  it("renders as Slot when asChild", () => {
    render(
      <Button asChild>
        <a href="/foo">Anchor</a>
      </Button>,
    );
    expect(screen.getByRole("link", { name: "Anchor" })).toBeInTheDocument();
  });
});
