import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/seo/site";

// Audit de creștere 2026-08-15: platforma nu avea NICIUN canal de achiziție —
// zero sitemap, zero metadata, deci zero șanse ca cineva să o găsească
// căutând „sushi Chișinău". Fiecare restaurant activ e o pagină publică pe
// care Google o poate indexa; asta e lista lor.
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const now = new Date();

  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, lastModified: now, changeFrequency: "daily", priority: 1 },
    { url: `${base}/restaurants`, lastModified: now, changeFrequency: "daily", priority: 0.9 },
    { url: `${base}/catering`, lastModified: now, changeFrequency: "weekly", priority: 0.9 },
    { url: `${base}/cum-functioneaza`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${base}/devino-partener`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/start/client`, lastModified: now, changeFrequency: "monthly", priority: 0.7 },
    { url: `${base}/start/curier`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/start/restaurant`, lastModified: now, changeFrequency: "monthly", priority: 0.6 },
    { url: `${base}/termeni`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
    { url: `${base}/confidentialitate`, lastModified: now, changeFrequency: "yearly", priority: 0.2 },
  ];

  // Un sitemap care crapă nu trebuie să scoată tot site-ul din index: dacă
  // baza nu răspunde, publicăm măcar rutele statice.
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from("restaurants")
      .select("slug, updated_at")
      .eq("is_active", true);

    const restaurantRoutes: MetadataRoute.Sitemap = (data ?? []).map((r) => ({
      url: `${base}/restaurants/${r.slug}`,
      lastModified: r.updated_at ? new Date(r.updated_at) : now,
      changeFrequency: "daily" as const,
      priority: 0.8,
    }));
    return [...staticRoutes, ...restaurantRoutes];
  } catch {
    return staticRoutes;
  }
}
