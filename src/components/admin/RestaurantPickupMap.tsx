"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { subscribeTable } from "@/lib/realtime/subscribeTable";
import { useRoute } from "@/hooks/useRoute";
import { DeliveryMap, type MapPoint } from "@/components/shared/DeliveryMap";
import { ReconnectNotice } from "@/components/shared/ReconnectNotice";

// Restaurant-side pickup coordination: the assigned courier heading to the
// restaurant, live. RLS (courier_locations_partner_read) only exposes the courier
// while the order is courier_assigned, so this naturally clears after pickup.
export function RestaurantPickupMap({
  restaurant,
  courierId,
  courierName,
  initialCourier,
}: {
  restaurant: MapPoint;
  courierId: string;
  courierName: string | null;
  initialCourier: MapPoint | null;
}) {
  const [pos, setPos] = useState<MapPoint | null>(initialCourier);
  // O hartă e cel mai convingător fel de a minți: marcatorul rămâne pe ecran,
  // arată exact ca o poziție curentă și nu are cum să pară vechi. Fără poll și
  // fără semnal de degradare, un websocket căzut lăsa bucătăria să creadă că
  //„mai are două minute" pentru un curier care era deja la ușă (sau plecase).
  const [degraded, setDegraded] = useState(false);

  // Route the courier's approach to the restaurant. No courier fix yet → no route.
  const { line: routeLine, minutes } = useRoute(pos, restaurant);
  const etaLabel = pos && minutes != null ? `Curier la ridicare ~${minutes} min` : undefined;

  // Ridicat din efect ca să-l poată chema și poll-ul de mai jos, FĂRĂ ca poll-ul
  // să reintre în dependențele abonamentului: cu `degraded` în lista efectului
  // de abonare, fiecare revenire ar fi rupt un canal sănătos ca să-l refacă
  // identic. Cele două preocupări stau acum în efecte separate, ca la ceilalți
  // consumatori (`OffersLive`, `OrderQueueLive`).
  const refetch = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("courier_locations")
      .select("lat, lng")
      .eq("courier_id", courierId)
      .maybeSingle();
    if (data?.lat != null && data?.lng != null) setPos({ lat: data.lat, lng: data.lng });
  }, [courierId]);

  useEffect(() => {
    const supabase = createClient();
    return subscribeTable(
      supabase,
      "rest-courier",
      "courier_locations",
      `courier_id=eq.${courierId}`,
      () => void refetch(),
      () => setDegraded(true), // onDegraded
      () => setDegraded(false), // onHealthy (recovered)
    );
  }, [courierId, refetch]);

  // Curierul își scrie poziția în `courier_locations` la ~45s (broadcast-ul de
  // ~10s nu atinge tabelul), deci un poll mai des decât atât ar cere aceleași
  // coordonate de două ori. 30s = sub ritmul sursei, peste ritmul unei hărți
  // care ar părea moartă.
  useEffect(() => {
    if (!degraded) return;
    const id = setInterval(() => void refetch(), 30000);
    return () => clearInterval(id);
  }, [degraded, refetch]);

  return (
    <section className="mb-5 flex flex-col gap-2 rounded-2xl bg-white/[0.04] p-4 ring-1 ring-white/[0.06]">
      <p className="text-sm font-semibold text-white">
        🛵 {courierName ?? "Curierul"} vine să ridice comanda
      </p>
      {/* Peste hartă, nu deasupra ei. Pusă în flux, pastila adăuga 36px paginii,
          iar banda `fixed bottom-4` a cozii — care stă la aceeași poziție în
          fereastră indiferent de conținut — ajungea să acopere butonul
          „Activează notificările": suprapunere măsurată 0 → 24,8px la 1440×900.
          Ca strat peste hartă costă zero înălțime la orice lățime și vorbește
          aceeași limbă cu pastila de ETA care stă deja pe hartă. */}
      <div className="relative">
        {degraded && (
          <div className="pointer-events-none absolute inset-x-0 top-2 z-[500] flex justify-center px-2">
            <ReconnectNotice detail="poziția poate fi cu până la 30s în urmă" placement="inline" />
          </div>
        )}
        <DeliveryMap pickup={restaurant} courier={pos} routeLine={routeLine} etaLabel={etaLabel} heightClass="h-48" />
      </div>
    </section>
  );
}
