import { StartHero } from "@/components/marketing/StartHero";

export const metadata = { title: "Devino curier — Dragons Delivery" };

// Poarta curierului: câștig clar, reguli clare. Fundalul e generat pentru
// sectorul ăsta (Higgsfield/Seedance): scuter pe asfalt ud, lumini calde de
// oraș la amurg — munca lui, nu o poză de stoc.
export default function StartCurierPage() {
  return (
    <StartHero
      sector="courier"
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
