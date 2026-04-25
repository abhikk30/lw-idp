import { describe, expect, it } from "vitest";
import { readPersistedTheme } from "../../src/lib/theme/init.js";

class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
}

describe("readPersistedTheme", () => {
  it("returns dark when storage is null", () => {
    expect(readPersistedTheme(null)).toBe("dark");
  });

  it("returns dark when key is missing", () => {
    expect(readPersistedTheme(new FakeStorage())).toBe("dark");
  });

  it("returns light when persisted state.theme is 'light'", () => {
    const s = new FakeStorage();
    s.set("lw-idp-ui", JSON.stringify({ state: { theme: "light" }, version: 0 }));
    expect(readPersistedTheme(s)).toBe("light");
  });

  it("returns dark when persisted state.theme is 'dark'", () => {
    const s = new FakeStorage();
    s.set("lw-idp-ui", JSON.stringify({ state: { theme: "dark" }, version: 0 }));
    expect(readPersistedTheme(s)).toBe("dark");
  });

  it("returns dark when JSON is malformed", () => {
    const s = new FakeStorage();
    s.set("lw-idp-ui", "not-json");
    expect(readPersistedTheme(s)).toBe("dark");
  });

  it("returns dark when state.theme is unexpected", () => {
    const s = new FakeStorage();
    s.set("lw-idp-ui", JSON.stringify({ state: { theme: "purple" }, version: 0 }));
    expect(readPersistedTheme(s)).toBe("dark");
  });
});
