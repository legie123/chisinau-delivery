import type { MetadataRoute } from "next";
import monolith from "@/app/manifest";

// Master app PWA: same icons/colors as the monolith, own identity + start page.
export default function manifest(): MetadataRoute.Manifest {
  return {
    ...monolith(),
    id: "/?app=master",
    name: "Dragons Master",
    short_name: "Master",
    description: "Centrul operațional al platformei Dragons Delivery.",
    start_url: "/platform",
    scope: "/",
  };
}
