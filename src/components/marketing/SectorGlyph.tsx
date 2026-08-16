// Pictogramele celor patru porți de pe hub.
//
// De ce există fișierul: până acum cardurile foloseau emoji (🍣 🗝️ 🛵 👨‍🍳).
// E exact defectul reparat în V4 pentru marcă, o treaptă mai jos: un emoji nu e
// desenat de noi, ci de fontul telefonului — pe iPhone iese ilustrația Apple, pe
// Android cea Google, iar paletele lor (roșu, verde, roz) nu există nicăieri în
// `docs/design/dragons-dna.json`. Pe deasupra, 👨‍🍳 e o secvență ZWJ din trei
// codepoint-uri: unde nu se compune, se rup în două caractere separate.
//
// Deci glifele sunt ale noastre: traseu, nu font. O singură grosime de linie,
// `currentColor` (culoarea o dă locul de folosire, nu fișierul ăsta), și forme
// alese ca să nu repete fotografia din spate — cardul are deja poza sectorului,
// glifa e o marcă, nu o a doua ilustrație.

type Glyph = "sushi" | "key" | "bag" | "cloche";

const PATHS: Record<Glyph, React.ReactNode> = {
  // Bețișoarele care ridică o rulou de maki. A treia formă pentru locul ăsta,
  // și primele două n-au fost respinse din gust, ci fiindcă mărite la 4× spuneau
  // altceva decât scrie pe card: nigiriul din profil (orez jos, felie deasupra)
  // se citea „hamburger", iar bolul cu abur — chiar cu buză și fum ondulat —
  // se citea „față zâmbitoare", fiindcă orice două semne peste un arc larg
  // devin ochi și gură. Bețișoarele n-au topologia asta: două diagonale
  // paralele nu pot deveni o figură, oricât le-ai micșora.
  sushi: (
    <>
      <path d="M3.8 18.2 14.4 7.6" />
      <path d="M6.4 20.8 15.6 11.6" />
      <circle cx="18" cy="6.6" r="2.9" />
    </>
  ),
  // Cheia de concierge: inel sus, tijă în jos, doi dinți. Semnul clasic al
  // omului care deschide locuri — spa, lounge, sală de business.
  key: (
    <>
      <circle cx="12" cy="6.4" r="3.6" />
      <path d="M12 10v10.4" />
      <path d="M12 15.2h3.6" />
      <path d="M12 18h2.6" />
    </>
  ),
  // Geanta de livrare, nu scuterul: o siluetă de scuter la 32px devine mâzgă,
  // iar geanta se citește la orice dimensiune și e ce ține curierul în mână.
  bag: (
    <>
      <path d="M4.6 8.4h14.8l-1.2 11.2H5.8z" />
      <path d="M9 8.4V6.2a3 3 0 0 1 6 0v2.2" />
    </>
  ),
  // Clopotul de servire: restaurantul e cel care ridică capacul.
  cloche: (
    <>
      <path d="M2.8 19.2h18.4" />
      <path d="M5 19.2a7 7 0 0 1 14 0" />
      <path d="M12 12.2V9.6" />
      <circle cx="12" cy="8.2" r="1.2" />
    </>
  ),
};

/**
 * Glifa unei porți de sector. Decorativă prin definiție — titlul de lângă ea
 * spune același lucru în cuvinte — deci `aria-hidden`, ca emoji-ul dinainte.
 */
export function SectorGlyph({ glyph, className = "" }: { glyph: Glyph; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
      focusable="false"
    >
      {PATHS[glyph]}
    </svg>
  );
}

export type { Glyph };
