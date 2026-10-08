import type { MetadataRoute } from "next";

// Aplicația instalabilă e a CLIENTULUI (stil Glovo/Wolt): pornește direct în lista de
// restaurante, nu în hub-ul cu patru sectoare. Curierul are aplicația lui nativă (mobile/driver).
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Dragons Delivery Chișinău",
    short_name: "Dragons",
    description: "Livrare sushi, fine dining și catering în Chișinău.",
    lang: "ro",
    start_url: "/restaurants",
    scope: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#0a0a14",
    theme_color: "#0d0d1f",
    categories: ["food", "shopping", "lifestyle"],
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
      {
        src: "/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    shortcuts: [
      { name: "Restaurante", url: "/restaurants", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Comenzile mele", url: "/orders", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
      { name: "Coș", url: "/cart", icons: [{ src: "/icon-192.png", sizes: "192x192" }] },
    ],
  };
}
