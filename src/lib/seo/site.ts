// Adresa publică a site-ului, într-un singur loc: o folosesc sitemap-ul,
// robots.txt, etichetele Open Graph și datele structurate. În producție se
// setează NEXT_PUBLIC_SITE_URL; local cade pe portul de dezvoltare.
export function siteUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : null) ??
    "http://localhost:3007";
  return raw.replace(/\/+$/, "");
}

export const SITE_NAME = "Dragons Delivery Chișinău";
export const SITE_TAGLINE = "Restaurante, sushi, spa, wellness și săli de business — într-un singur concierge";
