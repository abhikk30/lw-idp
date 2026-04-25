import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import HomePage from "../src/app/(app)/page.js";

describe("HomePage smoke", () => {
  it("renders heading without crashing", () => {
    const queryClient = new QueryClient();
    render(
      <QueryClientProvider client={queryClient}>
        <HomePage />
      </QueryClientProvider>,
    );
    expect(screen.getByRole("heading", { level: 1, name: "lw-idp" })).toBeInTheDocument();
  });
});
