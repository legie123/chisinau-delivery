"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import { ReconnectNotice } from "@/components/shared/ReconnectNotice";
import type { Order } from "@/lib/types/domain";

// SurfaceAudit P2 — the courier delivery-detail page had no realtime. If an
// admin reassigns the order away (admin_reassign_courier), this refreshes the
// server render so the page reflects the loss of assignment instead of showing
// stale status + buttons that then fail an ownership check. Row-filtered by
// order id; subscribeTable handles unique channel naming + bfcache pause/resume.
//
// Degradarea nu era cerută deloc, deci exact defectul pe care componenta asta
// îl repară se întorcea tăcut la prima cădere de websocket: comanda reasignată,
// ecranul neschimbat, iar curierul apasă „Am ajuns" pe o livrare care nu mai e
// a lui și primește un refuz de ownership fără explicație. Poll-ul de 15s ține
// pagina adevărată; banda spune de ce.
export function DeliveryLive({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [degraded, setDegraded] = useState(false);

  useEffect(() => {
    const supabase = createClient();
    return subscribeTable<Order>(
      supabase,
      "courier-delivery",
      "orders",
      `id=eq.${orderId}`,
      () => router.refresh(),
      () => setDegraded(true), // onDegraded
      () => setDegraded(false), // onHealthy (recovered)
    );
  }, [orderId, router]);

  // Reasignarea e rară dar scumpă, iar curierul e pe stradă: 15s e destul de
  // des ca să prindă pierderea comenzii înainte să bată la ușa restaurantului,
  // fără să reîmprospăteze pagina sub degetul lui la fiecare secundă.
  // Și cu realtime sănătos: după admin_reassign_courier RLS ascunde chiar UPDATE-ul
  // care ar anunța pierderea, deci abonarea nu se declanșează niciodată, iar pagina
  // veche transmitea clientului poziția fostului curier (verificator, 2026-10-04).
  // La 30s pagina se re-randează, comanda dispărută dă notFound și hook-ul GPS se
  // demontează.
  useEffect(() => {
    const id = setInterval(() => router.refresh(), degraded ? 15000 : 30000);
    return () => clearInterval(id);
  }, [degraded, router]);

  if (!degraded) return null;
  return <ReconnectNotice detail="starea livrării se reîmprospătează automat" placement="flow" />;
}
