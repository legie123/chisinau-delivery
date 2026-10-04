"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import { ReconnectNotice } from "@/components/shared/ReconnectNotice";
import type { Order } from "@/lib/types/domain";

// SurfaceAudit P2 — the courier delivery-detail page had no realtime. Status
// changes refresh the server render (row-filtered by order id; subscribeTable
// handles unique channel naming + bfcache pause/resume). A reassignment AWAY is
// invisible to realtime (RLS hides that UPDATE): the ownership poll below
// catches it, so the page stops showing stale buttons and its GPS hook unmounts.
//
// Degradarea nu era cerută deloc, deci exact defectul pe care componenta asta
// îl repară se întorcea tăcut la prima cădere de websocket: comanda reasignată,
// ecranul neschimbat, iar curierul apasă „Am ajuns" pe o livrare care nu mai e
// a lui și primește un refuz de ownership fără explicație. Poll-ul de 15s ține
// pagina adevărată; banda spune de ce.
export function DeliveryLive({ orderId, status }: { orderId: string; status: string }) {
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

  // Reasignarea e rară dar scumpă, iar curierul e pe stradă. Realtime n-o poate anunța: după
  // admin_reassign_courier RLS ascunde chiar UPDATE-ul care ar spune-o, iar pagina veche transmitea
  // clientului poziția fostului curier (verificator, 2026-10-04). Deci pagina întreabă și singură,
  // ieftin (un rând), dacă livrarea mai e a lui: la 30s, la 15s cât realtime e căzut (atunci prinde
  // și schimbările de stare). Doar un răspuns REUȘIT gol sau o stare schimbată re-randează pagina;
  // o citire eșuată sau lipsa sesiunii (un client expirat citește ca anon și nu vede rândul) nu
  // schimbă nimic — un refresh orb transforma orice sughiț al serverului în „Livrarea nu există”.
  useEffect(() => {
    const supabase = createClient();
    const id = setInterval(async () => {
      const { data: s } = await supabase.auth.getSession();
      if (!s.session) return;
      const { data, error } = await supabase.from("orders").select("status").eq("id", orderId).maybeSingle();
      if (error) return;
      if (!data || data.status !== status) router.refresh();
    }, degraded ? 15000 : 30000);
    return () => clearInterval(id);
  }, [degraded, router, orderId, status]);

  if (!degraded) return null;
  return <ReconnectNotice detail="starea livrării se reîmprospătează automat" placement="flow" />;
}
