"use client";

import { useEffect, useState } from "react";
import { SectorBackdrop } from "@/components/immersive/SectorBackdrop";

// Nivelul `focus` din contractul imersiv (§2 al rubricii), legat de singurul
// moment din sectorul curier care merită unul: cursa acceptată.
//
// Două lucruri l-au făcut să arate așa:
//
//  1. ACCEPTAREA VINE PE DOUĂ DRUMURI. Oferta împinsă (`OfferCard`, 30s) duce
//     curierul pe pagina livrării printr-un `router.push`; preluarea din listă
//     (`AvailableOrderRow`) îl lasă pe loc și doar reîmprospătează. Un moment
//     de confirmare montat într-una din pagini ar fi ratat celălalt drum, sau
//     ar fi fost montat de două ori, cu două comportamente. Aici e montat o
//     singură dată, în layoutul sectorului, deci supraviețuiește navigării:
//     confirmarea pornește în clipa apăsării și continuă peste schimbarea de
//     pagină, în loc să clipească și să moară odată cu ecranul vechi.
//
//  2. ATMOSFERA NU ARE VOIE SĂ ÎNTÂRZIE BANII (regula 1). De-aia semnalul e
//     dat ÎNAINTE de navigare, nu după, și nimeni nu așteaptă cele 2 secunde:
//     stratul e `pointer-events-none` și pagina livrării e deja dedesubt,
//     apăsabilă. Momentul se stinge singur (`holdMs` din contract).
//
// Semnalul trece prin `sessionStorage` + un eveniment de fereastră: evenimentul
// acoperă apăsarea din aceeași pagină, iar flagul acoperă cazul în care
// componenta se remontează în timpul navigării și ar pierde evenimentul.
const RIDE_ACCEPTED = "dragons:ride-accepted";

/** Chemat de ambele drumuri de acceptare, imediat ce serverul a confirmat. */
export function markRideAccepted() {
  try {
    sessionStorage.setItem(RIDE_ACCEPTED, "1");
    window.dispatchEvent(new Event(RIDE_ACCEPTED));
  } catch {
    // Fără sessionStorage (mod privat vechi, cotă plină) rămâne doar
    // evenimentul. Un moment de atmosferă pierdut nu are voie să rupă
    // acceptarea unei curse — de-aia toată funcția e best-effort.
  }
}

export function RideAcceptedFocus() {
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    function consume() {
      try {
        if (sessionStorage.getItem(RIDE_ACCEPTED) === null) return;
        sessionStorage.removeItem(RIDE_ACCEPTED);
      } catch {
        // vezi mai sus — dacă storage-ul nu răspunde, evenimentul e suficient
      }
      setPlaying(true);
    }

    consume(); // apăsare urmată de navigare: flagul e deja pus la montare
    window.addEventListener(RIDE_ACCEPTED, consume); // apăsare în aceeași pagină
    return () => window.removeEventListener(RIDE_ACCEPTED, consume);
  }, []);

  if (!playing) return null;
  return <SectorBackdrop sector="courier" intensity="focus" onDone={() => setPlaying(false)} />;
}
