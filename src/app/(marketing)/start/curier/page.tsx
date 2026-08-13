import { StartHero } from "@/components/marketing/StartHero";

export const metadata = { title: "Devino curier — Dragons Delivery" };

// Poarta curierului: câștig clar, reguli clare. Fără video dedicat încă —
// imaginea de curier din hub, cu drift ambient (același limbaj vizual).
export default function StartCurierPage() {
  return (
    <StartHero
      media={{ image: "https://images.unsplash.com/photo-1526367790999-0150786686a2?w=1600&h=1000&fit=crop" }}
      eyebrow="Pentru curieri"
      headline="Livrezi. Câștigi. În ritmul tău."
      sub="Oferte de livrare direct pe telefon, câștiguri vizibile pe fiecare cursă și predare de numerar fără bătăi de cap."
      bullets={[
        "Oferta vine pe telefon — o accepți în 30 de secunde",
        "Vezi exact cât câștigi pe fiecare livrare",
        "Plafonul de numerar te protejează — predai când e plin",
        "Program flexibil: online când vrei tu",
      ]}
      ctas={[
        { href: "/devino-partener", label: "Devino curier", primary: true },
        { href: "/login?next=/deliveries", label: "Am deja cont" },
      ]}
    />
  );
}
