/* Marca de brand — creasta dragonului.
 *
 * Până acum marca era emoji-ul 🐉, pus direct în 15 locuri. Un emoji nu e un
 * logo: fiecare sistem de operare îl desenează cu fontul lui, deci pe iPhone
 * (42% din piața Chișinăului) apărea dragonul verde-lucios al Apple, pe Android
 * cel al Google, pe Windows altul. Verdele nu există în paleta noastră — marca
 * se certa cu propriul cuvânt-marcă auriu de sub ea, pe fiecare ecran.
 *
 * Fișierul din `public/brand/` e un SVG adevărat (vector), servit o singură dată
 * și ținut în cache, nu inline de 15 ori. E `<img>` cu sursă statică, deci
 * browserul îl poate reutiliza între rute fără să reîncarce nimic.
 *
 * Lățimea și înălțimea sunt scrise explicit în atribute, nu doar în clase:
 * altfel imaginea are 0×0 până se descarcă și rândul de sub ea sare (regula de
 * zero layout shift din rubrică, §8).
 */

// Cele trei dimensiuni din rubrică (§7). Nu sunt gusturi — sunt exact taliile
// pe care marca le avea deja în produs, măsurate în capturi: antetele de pagină
// stăteau la 36px, porțile și ecranele de intrare la 48px, paginile de eroare la 60px.
const SIZES = { sm: 36, md: 48, lg: 60 } as const;

type Props = {
  size?: keyof typeof SIZES;
  className?: string;
};

export function BrandMark({ size = "md", className = "" }: Props) {
  const px = SIZES[size];
  return (
    // eslint-disable-next-line @next/next/no-img-element -- SVG static, nu are ce optimiza next/image
    <img
      src="/brand/dragons-crest.svg"
      alt=""
      aria-hidden
      width={px}
      height={px}
      className={`select-none ${className}`}
      style={{ width: px, height: px }}
    />
  );
}

/* Varianta decorativă: aceeași marcă, dar ca filigran în colțul unui card.
 * Aici dimensiunea vine în pixeli fiindcă nu e un element de identitate, ci o
 * textură care se potrivește cardului pe care stă (56px pe cardurile mici,
 * 80-90px pe cele mari). Opacitatea rămâne la apelant, ca înainte. */
export function BrandWatermark({
  px,
  className = "",
}: {
  px: number;
  className?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- idem: sursă statică
    <img
      src="/brand/dragons-crest.svg"
      alt=""
      aria-hidden
      width={px}
      height={px}
      className={`pointer-events-none select-none ${className}`}
      style={{ width: px, height: px }}
    />
  );
}
