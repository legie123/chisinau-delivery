"use client";

import { useEffect, useRef, useState } from "react";
import {
  SECTORS,
  planBackdrop,
  resolveBackdropMedia,
  type Intensity,
  type Sector,
} from "@/components/immersive/sectors";

// Fundalul de sector — singurul component care are voie să pună atmosferă în
// spatele unui ecran (rubrica §2). Trei lucruri le rezolvă structural, nu prin
// bunăvoința fiecărei pagini:
//
//  1. LANȚUL DE FALLBACK, în ordine: video → poster → gradient. Toate trei sunt
//     straturi absolute în aceeași cutie fixă, deci trecerea de la unul la
//     altul nu mișcă niciun pixel de layout. Gradientul e pictat din SSR, așa
//     că ecranul e corect chiar înainte să existe JavaScript sau imagini.
//  2. `hero` SE STINGE după primul ecran. Înainte, fundalul era `fixed` și
//     curgea sub toată pagina — pe /concierge listele stăteau peste un video în
//     mișcare. Un reper absolut de la începutul paginii spune, printr-un
//     IntersectionObserver, când am trecut de deschidere; atunci fundalul se
//     retrage în 300 ms și rămâne substratul curat.
//  3. MIȘCAREA ARE UN MOTIV. Fără `prefers-reduced-motion`, fără baterie sub
//     20% neîncărcată: atunci nu se încarcă video deloc, dar posterul rămâne la
//     aceeași opacitate — cine cere liniște primește aceeași imagine, nu alta.
export function SectorBackdrop({
  sector,
  intensity = "ambient",
  variant,
  onDone,
}: {
  sector: Sector;
  intensity?: Intensity;
  /** o lume din interiorul sectorului (concierge: tipul locației) */
  variant?: string | null;
  /** `focus`: se cheamă după ce momentul s-a stins */
  onDone?: () => void;
}) {
  const cfg = SECTORS[sector];

  const [motionOk, setMotionOk] = useState(false);
  // Ecran lat = poate exista o variantă proprie (vezi `SectorMedia.wide`).
  // Pornim de la `false` ca SSR-ul și prima randare să coincidă; dacă e lat,
  // efectul de mai jos schimbă sursa înainte să se vadă ceva, iar straturile
  // sunt oricum absolute — nu se mișcă niciun pixel de layout.
  const [wide, setWide] = useState(false);
  const [posterOk, setPosterOk] = useState(true);
  const [videoOk, setVideoOk] = useState(true);
  const [visible, setVisible] = useState(true);
  const anchorRef = useRef<HTMLDivElement | null>(null);

  // `ambient` are voie să ceară un asset mai ieftin decât deschiderea de ecran:
  // stă sub o interfață de lucru, pe date mobile, și nu se uită nimeni la el.
  const chosen = resolveBackdropMedia(sector, intensity, variant);
  // Un asset vertical mărit pe desktop devine o pastă; dacă și-a declarat
  // varianta lată, aceea câștigă acolo.
  const media = wide && chosen.wide ? { ...chosen.wide, veil: chosen.veil } : chosen;

  const plan = planBackdrop(
    sector,
    intensity,
    { motionOk, hasVideo: Boolean(media.video) && videoOk },
    variant,
  );

  // Mișcarea pornește DUPĂ montare, niciodată în SSR: așa nu există nepotrivire
  // de hidratare și nu se cheltuie octeți pentru cine a cerut liniște.
  useEffect(() => {
    let cancelled = false;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");

    const decide = async () => {
      if (mq.matches) {
        if (!cancelled) setMotionOk(false);
        return;
      }
      // Bateria e opțională (API-ul nu există pe Safari/Firefox) — lipsa lui
      // înseamnă „nu știm", deci mișcarea rămâne pornită.
      const nav = navigator as Navigator & {
        getBattery?: () => Promise<{ level: number; charging: boolean }>;
      };
      try {
        const battery = await nav.getBattery?.();
        if (battery && !battery.charging && battery.level < 0.2) {
          if (!cancelled) setMotionOk(false);
          return;
        }
      } catch {
        /* fără informație despre baterie = fără motiv să oprim */
      }
      if (!cancelled) setMotionOk(true);
    };

    const onChange = () => void decide();
    void decide();
    mq.addEventListener("change", onChange);

    // Pragul de „lat": peste el, un cadru vertical ar fi mărit și tăiat.
    const wideMq = window.matchMedia("(min-width: 900px)");
    const onWide = () => setWide(wideMq.matches);
    onWide();
    wideMq.addEventListener("change", onWide);

    return () => {
      cancelled = true;
      mq.removeEventListener("change", onChange);
      wideMq.removeEventListener("change", onWide);
    };
  }, []);

  // `hero`: reperul de la începutul paginii iese din ecran ⇒ atmosfera se retrage.
  useEffect(() => {
    if (!plan.fadesOnScroll) return;
    const el = anchorRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), {
      threshold: 0,
    });
    io.observe(el);
    return () => io.disconnect();
  }, [plan.fadesOnScroll]);

  // `focus`: momentul ține cât spune contractul, apoi se stinge singur.
  const [holding, setHolding] = useState(true);
  useEffect(() => {
    if (plan.holdMs === null) return;
    const stop = window.setTimeout(() => setHolding(false), plan.holdMs);
    const done = window.setTimeout(() => onDone?.(), plan.holdMs + 320);
    return () => {
      window.clearTimeout(stop);
      window.clearTimeout(done);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- momentul se armează o dată
  }, [plan.holdMs]);

  const shown = plan.holdMs !== null ? holding : visible;
  const showVideo = plan.showVideo && shown && media.video;

  return (
    <>
      {/* Reperul deschiderii: absolut, fără fundal, fără dimensiune în flux —
          există doar ca observatorul să aibă ce urmări. */}
      {plan.fadesOnScroll && (
        <div ref={anchorRef} aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[62vh]" />
      )}

      <div
        aria-hidden
        // `-z-10` la TOATE nivelurile, inclusiv `focus`. Momentul de confirmare
        // stătea la `z-30`, adică peste interfață — vezi comentariul din
        // `planBackdrop`: la prima montare pe ecran real a ascuns exact livrarea
        // pe care o confirma. Atmosfera nu trece niciodată în fața comenzii.
        className="pointer-events-none fixed inset-0 -z-10 overflow-hidden transition-opacity duration-300 ease-out"
        style={{ opacity: shown ? 1 : 0 }}
      >
        {/* nivel 3 — gradientul: singurul strat care nu poate lipsi */}
        <div className="absolute inset-0" style={{ background: cfg.gradient }} />

        {/* nivel 2 — posterul: baza SSR/LCP; dacă dă 404 rămâne gradientul */}
        {posterOk && (
          /* eslint-disable-next-line @next/next/no-img-element -- stil de casă: img simplu, rezistent la CDN */
          <img
            // `onError` singur NU e de ajuns: imaginea e randată din SSR, deci
            // poate eșua ÎNAINTE ca React să apuce să-și lege ascultătorul, iar
            // evenimentul se pierde — atunci rămâne pe ecran pictograma de
            // imagine ruptă, exact peste gradientul care trebuia s-o
            // înlocuiască. (Prins la proba cu assetele blocate, nu la citit.)
            // La atașare verificăm starea REALĂ a elementului, nu doar viitorul.
            ref={(el) => {
              if (el?.complete && el.naturalWidth === 0) setPosterOk(false);
            }}
            src={media.poster}
            alt=""
            onError={() => setPosterOk(false)}
            className="absolute inset-0 h-full w-full object-cover"
            style={{ opacity: plan.mediaOpacity }}
          />
        )}

        {/* nivel 1 — video-ul: numai când mișcarea are voie */}
        {showVideo && (
          <video
            // React nu scrie sigur ATRIBUTUL `muted` din JSX (facebook/react#10389)
            // iar un video nemut e blocat la autoplay — se pune direct pe element.
            ref={(el) => {
              if (el) {
                el.muted = true;
                el.play().catch(() => {});
              }
            }}
            src={media.video}
            poster={media.poster}
            onError={() => setVideoOk(false)}
            autoPlay
            muted
            loop
            playsInline
            preload={plan.preload}
            className={`absolute inset-0 h-full w-full object-cover ${plan.drift ? "ambient-drift" : ""}`}
            style={{ opacity: plan.mediaOpacity, "--drift-to": plan.driftScale } as React.CSSProperties}
          />
        )}

        {/* voalul: contrastul textului se obține cu un strat, nu cu noroc */}
        <div className="absolute inset-0" style={{ background: `rgba(10, 10, 20, ${plan.veilOpacity})` }} />

        {/* Ancora de jos a foldului — exact tratamentul care rula deja în
            producție (`h-1/4`, 85% → transparent). Nu-l atinge valul ăsta:
            migrarea are voie să mute unde stă atmosfera, nu cum arată. */}
        {plan.holdMs === null ? (
          <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-[#0a0a14]/85 to-transparent" />
        ) : (
          /* `focus`: o singură pulsație de accent pe margini, apoi liniște */
          <div
            className="absolute inset-0"
            style={{ boxShadow: `inset 0 0 180px 40px ${cfg.accent}22` }}
          />
        )}
      </div>
    </>
  );
}
