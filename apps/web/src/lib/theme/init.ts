/**
 * Reads the persisted UI theme from a Storage-like object.
 *
 * Mirrors the logic of {@link themeInitScript} in `./script.ts` — both must
 * agree on the same localStorage shape so that the inline script's pre-paint
 * decision matches what the Zustand persist layer will rehydrate to.
 */
export function readPersistedTheme(
  storage: Pick<Storage, "getItem"> | null = null,
): "light" | "dark" {
  if (typeof storage === "undefined" || storage === null) {
    return "dark";
  }
  try {
    const raw = storage.getItem("lw-idp-ui");
    if (!raw) {
      return "dark";
    }
    const parsed = JSON.parse(raw) as { state?: { theme?: unknown } } | null;
    const theme = parsed?.state?.theme;
    return theme === "light" ? "light" : "dark";
  } catch {
    return "dark";
  }
}
