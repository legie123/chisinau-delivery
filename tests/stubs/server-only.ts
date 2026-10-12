// vitest runs outside the React Server Components condition, where the real "server-only"
// package throws on import. Next still enforces it in builds; unit tests get this no-op.
export {};
