"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { sectorForPath, type SectorKey } from "@/lib/immersive/sectors";
import type { SilkHandle, Tier } from "@/lib/immersive/silk";

// Fundalul imersiv trăiește AICI, o singură dată, în layout — nu în pagini.
// Așa trecerea de la un sector la altul e o transformare de culoare pe aceeași
// pânză (decizia: „se transformă lin"), nu o repornire de canvas la fiecare
// navigare. Paginile nu știu nimic despre el; ruta decide sectorul.
//
// three.js se încarcă doar după ce știm că merită: dynamic import, după proba
// de capabilitate. Pe telefoanele slabe și la `prefers-reduced-motion` nu se
// descarcă deloc — rămâne gradientul static de dedesubt.
export function ImmersiveBackdrop() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const handleRef = useRef<SilkHandle | null>(null);
  const [tier, setTier] = useState<Tier | "off" | null>(null);

  const sector: SectorKey | null = sectorForPath(pathname, searchParams.toString());
  const active = sector !== null;

  // Sondă de diagnostic (rămâne: e ieftină și face depanarea pe telefon real
  // posibilă fără instrumente — se citește din consolă ca `__silk`).
  if (typeof window !== "undefined") {
    (window as unknown as { __silk?: unknown }).__silk = {
      sector, active, tier, hasCanvas: !!canvasRef.current, mounted: !!handleRef.current,
    };
  }

  // 1) Decidem o singură dată pe sesiune ce poate duce dispozitivul.
  useEffect(() => {
    if (!active || tier !== null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setTier("off");
      return;
    }
    let cancelled = false;
    import("@/lib/immersive/silk").then(({ probeTier }) =>
      probeTier().then((t) => {
        if (!cancelled) setTier(t);
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [active, tier]);

  // 2) Montăm scena doar dacă proba a trecut.
  useEffect(() => {
    if (!active || !tier || tier === "off" || !canvasRef.current || handleRef.current) return;
    let cancelled = false;
    import("@/lib/immersive/silk").then(({ createSilk }) => {
      if (cancelled || !canvasRef.current) return;
      handleRef.current = createSilk(canvasRef.current, sector ?? "hub", tier);
    });
    return () => {
      cancelled = true;
    };
  }, [active, tier, sector]);

  // 3) Schimbarea rutei doar recolorează lumea.
  useEffect(() => {
    if (sector && handleRef.current) handleRef.current.setSector(sector);
  }, [sector]);

  // 4) Scroll-ul împinge materialul în adâncime.
  useEffect(() => {
    if (!active) return;
    const onScroll = () => {
      const max = Math.max(1, document.body.scrollHeight - window.innerHeight);
      handleRef.current?.setScroll(Math.min(window.scrollY / max, 1));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [active]);

  // Curățare la ieșirea din zonele cu fundal (panouri, checkout): eliberăm
  // contextul WebGL, ca operarea să nu plătească nimic.
  useEffect(() => {
    if (active) return;
    handleRef.current?.dispose();
    handleRef.current = null;
  }, [active]);

  useEffect(() => () => {
    handleRef.current?.dispose();
    handleRef.current = null;
  }, []);

  if (!active) return null;

  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden>
      {/* Baza statică: se vede instant, ține locul până se decide tier-ul și
          rămâne singura imagine pe dispozitivele care nu duc scena. */}
      <div className="absolute inset-0 bg-[radial-gradient(120%_90%_at_50%_15%,#151426_0%,#0a0a14_60%,#07070f_100%)]" />
      {tier && tier !== "off" && <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />}
      {/* Ancoră jos, ca textul de pe plăci să aibă pe ce sta. */}
      <div className="absolute inset-x-0 bottom-0 h-1/4 bg-gradient-to-t from-[#0a0a14]/80 to-transparent" />
    </div>
  );
}
