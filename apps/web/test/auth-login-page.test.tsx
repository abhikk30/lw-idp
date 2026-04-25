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

  it("drops absolute-URL redirect values from the hidden input", async () => {
    const ui = await LoginPage({ searchParams: Promise.resolve({ redirect: "https://evil.com" }) });
    const { container } = render(ui as React.ReactElement);
    const hidden = container.querySelector('input[name="redirect"]');
    expect(hidden).toBeNull();
  });

  it("drops protocol-relative URL redirect values", async () => {
    const ui = await LoginPage({ searchParams: Promise.resolve({ redirect: "//evil.com" }) });
    const { container } = render(ui as React.ReactElement);
    const hidden = container.querySelector('input[name="redirect"]');
    expect(hidden).toBeNull();
  });

  it("drops bare-path (no leading slash) redirect values", async () => {
    const ui = await LoginPage({ searchParams: Promise.resolve({ redirect: "services" }) });
    const { container } = render(ui as React.ReactElement);
    const hidden = container.querySelector('input[name="redirect"]');
    expect(hidden).toBeNull();
  });

  it("drops javascript:-scheme redirect values", async () => {
    const ui = await LoginPage({
      searchParams: Promise.resolve({ redirect: "javascript:alert(1)" }),
    });
    const { container } = render(ui as React.ReactElement);
    const hidden = container.querySelector('input[name="redirect"]');
    expect(hidden).toBeNull();
  });

  it("preserves leading-slash relative redirect values", async () => {
    const ui = await LoginPage({
      searchParams: Promise.resolve({ redirect: "/services/svc-1" }),
    });
    const { container } = render(ui as React.ReactElement);
    const hidden = container.querySelector('input[name="redirect"]');
    expect(hidden).not.toBeNull();
    expect(hidden?.getAttribute("value")).toBe("/services/svc-1");
  });
});
