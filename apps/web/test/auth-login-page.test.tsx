import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import LoginPage from "../src/app/auth/login/page.js";

describe("LoginPage", () => {
  it("renders sign-in heading + button", async () => {
    const ui = await LoginPage({ searchParams: Promise.resolve({}) });
    render(ui as React.ReactElement);
    expect(screen.getByRole("heading", { name: /welcome to lw-idp/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /sign in with github/i })).toBeInTheDocument();
  });

  it("preserves redirect= via hidden input when supplied", async () => {
    const ui = await LoginPage({ searchParams: Promise.resolve({ redirect: "/services" }) });
    const { container } = render(ui as React.ReactElement);
    const hidden = container.querySelector('input[name="redirect"]');
    expect(hidden).not.toBeNull();
    expect(hidden?.getAttribute("value")).toBe("/services");
  });

  it("omits redirect hidden input when no redirect param", async () => {
    const ui = await LoginPage({ searchParams: Promise.resolve({}) });
    const { container } = render(ui as React.ReactElement);
    const hidden = container.querySelector('input[name="redirect"]');
    expect(hidden).toBeNull();
  });
});
