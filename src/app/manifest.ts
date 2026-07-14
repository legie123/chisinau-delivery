import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chișinău Delivery",
    short_name: "Chișinău Delivery",
    description: "Livrare sushi și fine dining în Chișinău.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0d0d1f",
    icons: [
      {
        src: "/icon-192.png",
        sizes: "192x192",
        type: "image/png",
      },
      {
        src: "/icon-512.png",
        sizes: "512x512",
        type: "image/png",
      },
    ],
  };
}
