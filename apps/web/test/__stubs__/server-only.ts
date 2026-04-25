// No-op stub for the `server-only` marker package, used by Vitest under jsdom.
// In production, Next's RSC bundler resolves `server-only` to its empty.js via
// the `react-server` export condition. The default condition throws, which is
// how the package guards against accidental Client Component imports — but
// Vitest's jsdom environment is neither RSC nor Client, so we substitute this
// no-op stub instead.
export {};
