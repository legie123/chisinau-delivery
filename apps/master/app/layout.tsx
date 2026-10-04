import type { Metadata } from "next";
import { metadata as monolith } from "@/app/layout";

// Thin shell: fonts, globals.css, AuthListener and the SW register all come
// from the monolith root layout. Only the app identity differs.
export { default, viewport } from "@/app/layout";

export const metadata: Metadata = {
  ...monolith,
  applicationName: "Dragons Master",
  manifest: "/manifest.webmanifest",
  // Internal ops console — never indexed.
  robots: { index: false, follow: false },
};
