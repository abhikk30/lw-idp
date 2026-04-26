import { describe, expect, it } from "vitest";
import { themeInitScript } from "../../src/lib/theme/script.js";

describe("themeInitScript", () => {
  it("sets data-theme=dark when localStorage is empty", () => {
    (document.documentElement.dataset as Record<string, string | undefined>).theme = undefined;
    localStorage.clear();
    new Function(themeInitScript)();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });

  it("sets data-theme=light when localStorage holds light", () => {
    (document.documentElement.dataset as Record<string, string | undefined>).theme = undefined;
    localStorage.setItem("lw-idp-ui", JSON.stringify({ state: { theme: "light" }, version: 0 }));
    new Function(themeInitScript)();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("falls back to dark on malformed JSON", () => {
    (document.documentElement.dataset as Record<string, string | undefined>).theme = undefined;
    localStorage.setItem("lw-idp-ui", "garbage");
    new Function(themeInitScript)();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
