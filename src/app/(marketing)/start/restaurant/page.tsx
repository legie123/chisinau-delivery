import { StartHero } from "@/components/marketing/StartHero";

export const metadata = { title: "Devino partener — Dragons Delivery" };

// Poarta restaurantului: video-ul flame (Higgsfield) = bucătăria vie.
// Mesajul e control + vizibilitate, nu „încă o platformă de comenzi".
export default function StartRestaurantPage() {
  return (
    <StartHero
      media={{ video: { src: "/videos/hero-flame.mp4", poster: "/videos/hero-flame-poster.jpg" } }}
      eyebrow="Pentru restaurante"
      headline="Bucătăria ta, în fața orașului"
      sub="Primești comenzi cu reguli clare, meniul tău arată impecabil și vezi exact câți bani îți intră — comision, payouts, analiză."
      bullets={[
        "Comenzile vin cu SLA clar — 7 minute să răspunzi, nimic pierdut în zgomot",
        "Meniu cu fotografii premium generate pentru tine",
        "Catering cu cotații — tu decizi prețul evenimentului",
        "Câștiguri și payouts la vedere, fără surprize",
      ]}
      ctas={[
        { href: "/devino-partener", label: "Devino partener", primary: true },
        { href: "/login?next=/restaurant/orders", label: "Am deja panou" },
      ]}
    />
  );
}
