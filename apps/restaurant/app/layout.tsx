import type { Metadata } from "next";
import { metadata as monolith } from "@/app/layout";

// Thin shell: fonts, globals.css, AuthListener and the SW register all come
// from the monolith root layout. Only the app identity differs.
export { default, viewport } from "@/app/layout";

export const metadata: Metadata = {
  ...monolith,
  applicationName: "Dragons Partener",
  manifest: "/manifest.webmanifest",
  // A partner back-office: nothing here is meant for search engines.
  robots: { index: false, follow: false },
};
