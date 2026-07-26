// @chisinau/shared-api — typed RPC wrappers shared by web and (later) Expo.
// Rules: the Supabase client is always passed IN (never created here);
// @supabase/supabase-js is a peerDependency (a bundled copy would mean two
// clients with two parallel auth sessions); no React/Next/Expo imports ever.
export * from "./errors";
export * from "./dispatch";
export * from "./lifecycle";
export * from "./orders";
export * from "./payments";
export * from "./payouts";
export * from "./onboarding";
export * from "./discovery";
export * from "./notifications";
export * from "./cash";
export * from "./tariff";
