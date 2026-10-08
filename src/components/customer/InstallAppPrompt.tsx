"use client";

import { useEffect, useState } from "react";
import { useHydrated } from "@/hooks/useHydrated";
import { useCartStore } from "@/lib/orders/cart";

// Banda „Instalează aplicația" — doar pe telefon, doar în browser (nu în aplicația
// deja instalată). Două drumuri, fiindcă platformele n-au același mecanism:
//   - Android / Chrome / Edge / Samsung: `beforeinstallprompt` → butonul deschide
//     dialogul nativ de instalare.
//   - iPhone / iPad: Safari NU are eveniment de instalare; singura cale e
//     Partajează → „Adaugă pe ecranul principal", deci arătăm instrucțiunea.
// Închiderea se ține în localStorage; poate lipsi (navigare privată) — atunci
// banda doar reapare la vizita următoare, nimic nu se strică.
// Plutește deasupra barei de jos în loc să stea în pagină: apare abia după hidratare,
// iar în flux ar împinge tot conținutul în jos (CLS, vezi podeaua din layout). Cu coșul
// plin tace — acolo e pastila „Vezi coșul", iar omul e în mijlocul comenzii.

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };

const DISMISS_KEY = "dd-install-dismissed";

function readDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

export function InstallAppPrompt() {
  const hydrated = useHydrated();
  const [installEvent, setInstallEvent] = useState<InstallEvent | null>(null);
  const [closed, setClosed] = useState(false);
  const cartEmpty = useCartStore((s) => s.lines.length === 0);

  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setInstallEvent(e as InstallEvent);
    };
    const onInstalled = () => setClosed(true);
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (!hydrated || closed || !cartEmpty || readDismissed()) return null;

  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return null;

  const ua = navigator.userAgent;
  const ios = /iphone|ipad|ipod/i.test(ua) || (/macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  if (!installEvent && !ios) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setClosed(true);
  };

  const install = async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    setInstallEvent(null);
    if (outcome === "accepted") setClosed(true);
  };

  return (
    <div className="fixed inset-x-3 bottom-[calc(var(--tabbar-h,0px)_+_0.75rem)] z-50 flex items-center gap-3 rounded-2xl border border-gold/25 bg-[#14141f] p-3 shadow-2xl shadow-black/60 sm:hidden">
      {/* eslint-disable-next-line @next/next/no-img-element -- iconiță statică de 40px */}
      <img src="/icon-192.png" alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-xl" />
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-semibold text-white">Instalează aplicația</p>
        {installEvent ? (
          <p className="text-white/55">Comandă mai rapid, direct de pe ecranul principal.</p>
        ) : (
          <p className="text-white/55">
            Apasă <span className="font-semibold text-white">Partajează</span>, apoi{" "}
            <span className="font-semibold text-white">„Adaugă pe ecranul principal”</span>.
          </p>
        )}
      </div>
      {installEvent && (
        <button
          type="button"
          onClick={install}
          className="shrink-0 rounded-full bg-primary-dark px-4 py-2.5 text-sm font-semibold text-white hover:bg-primary-darker"
        >
          Instalează
        </button>
      )}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Închide"
        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-white/50 hover:text-white"
      >
        <svg aria-hidden className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
          <path strokeLinecap="round" d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>
  );
}
