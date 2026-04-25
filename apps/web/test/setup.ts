import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement ResizeObserver; cmdk (used by CommandPalette) needs it.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}

// jsdom doesn't implement Element.scrollIntoView; cmdk calls it when an item
// becomes selected.
if (typeof Element !== "undefined" && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = (): void => {};
}
