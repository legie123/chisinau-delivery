import type { MetadataRoute } from "next";
import { siteUrl } from "@/lib/seo/site";

// Public: hub, restaurante, catering, paginile de start. Interzis: tot ce ține
// de conturi și operare (panouri, coș, checkout, urmărirea comenzii, poarta
// master) — nu au ce căuta într-un index de căutare.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/platform",
          "/platform/",
          "/restaurant/",
          "/deliveries",
          "/deliveries/",
          "/earnings",
          "/cart",
          "/checkout",
          "/orders",
          "/orders/",
          "/master",
          "/master/",
          "/enter/",
          "/login",
        ],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
