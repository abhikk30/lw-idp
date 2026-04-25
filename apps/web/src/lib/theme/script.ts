/**
 * IIFE injected into <head> to set <html data-theme> before paint.
 * Mirrors readPersistedTheme() in ./init.ts — DO NOT diverge: both should
 * produce the same answer for the same localStorage shape.
 */
export const themeInitScript = `
(function () {
  try {
    var raw = localStorage.getItem("lw-idp-ui");
    if (!raw) {
      document.documentElement.dataset.theme = "dark";
      return;
    }
    var parsed = JSON.parse(raw);
    var theme = parsed && parsed.state && parsed.state.theme;
    document.documentElement.dataset.theme = theme === "light" ? "light" : "dark";
  } catch (_e) {
    document.documentElement.dataset.theme = "dark";
  }
})();
`.trim();
