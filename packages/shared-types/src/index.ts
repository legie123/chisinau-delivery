// @chisinau/shared-types — the single source of truth for DB schema types,
// status enums, the delivery transition map, labels, and branded IDs.
// Consumed by the Next.js app today and the Expo apps when they join the
// workspace. NO React / Next / Expo imports may ever appear here (a duplicated
// React in shared packages causes runtime "Invalid hook call" with no compile
// error — keep this package platform-free).
export type { Database, Json } from "./generated";
export * from "./enums";
export * from "./transitions";
export * from "./labels";
export * from "./ids";
