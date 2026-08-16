import { StartHero } from "@/components/marketing/StartHero";

export const metadata = { title: "Comandă — Dragons Delivery" };

// Poarta clientului: fine dining acasă. Video-ul pour (Higgsfield) = ritualul
// mesei, nu logistică. Browse-ul e deschis fără cont; contul apare la checkout.
export default function StartClientPage() {
  return (
    <StartHero
      sector="customer"
      eyebrow="Pentru tine"
      headline="Fine dining, la ușa ta"
      sub="Sushi și bucătărie fină din cele mai bune restaurante din Chișinău — fotografii reale, livrare urmărită live, plata cash sau card la ușă."
      bullets={[
        "Meniuri cu fotografii reale, nu poze de stoc",
        "Urmărești comanda live, de la bucătărie până la ușă",
        "Programezi livrarea când îți convine",
        "Catering pentru evenimente, cu ofertă în 3 pași",
      ]}
      ctas={[
        { href: "/restaurants", label: "Vezi restaurantele", primary: true },
        { href: "/login?next=/restaurants", label: "Intră în cont" },
      ]}
    />
  );
}
