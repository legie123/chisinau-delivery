import { StartHero } from "@/components/marketing/StartHero";

export const metadata = { title: "Devino partener — restaurant, spa, wellness sau sală de business" };

// Poarta partenerilor. De la 2026-08-15 rețeaua nu mai e doar de restaurante:
// intră și spa-uri, lounge-uri de wellness și săli de business, fiindcă
// platforma a devenit concierge. Video-ul flame (Higgsfield) rămâne — bucătăria
// vie e tot cea mai puternică imagine a rețelei.
export default function StartRestaurantPage() {
  return (
    <StartHero
      media={{ video: { src: "/videos/hero-flame.mp4", poster: "/videos/hero-flame-poster.jpg" } }}
      eyebrow="Pentru parteneri"
      headline="Locul tău, în fața orașului"
      sub="Restaurant, sushi bar, spa, lounge de wellness sau sală de business — intri în rețeaua concierge și primești comenzi și rezervări dintr-un singur loc."
      bullets={[
        "Comenzi cu reguli clare — 7 minute să răspunzi, nimic pierdut în zgomot",
        "Rezervări cu ofertă: tu pui prețul intervalului, clientul confirmă",
        "Catering și evenimente, pentru firmele care revin săptămânal",
        "Câștiguri și plăți la vedere, fără surprize",
      ]}
      ctas={[
        { href: "/devino-partener", label: "Devino partener", primary: true },
        { href: "/login?next=/restaurant/orders", label: "Am deja panou" },
      ]}
    />
  );
}
