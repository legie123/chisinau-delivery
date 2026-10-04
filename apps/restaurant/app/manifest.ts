import type { MetadataRoute } from "next";
import monolith from "@/app/manifest";

// Restaurant partner PWA: same icons as the monolith, own identity + start page.
export default function manifest(): MetadataRoute.Manifest {
  return {
    ...monolith(),
    id: "/?app=restaurant",
    name: "Dragons Partener",
    short_name: "Partener",
    description: "Comenzi, meniu și program pentru restaurantele partenere Dragons.",
    start_url: "/restaurant/orders",
    scope: "/",
    background_color: "#0d0d1f",
    theme_color: "#0d0d1f",
  };
}
