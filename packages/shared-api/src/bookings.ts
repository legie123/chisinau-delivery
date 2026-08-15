import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";
import { RpcError } from "./errors";

type Db = SupabaseClient<Database>;

// Concierge (2026-08-15) — rezervări de locații: sală de business, spa, lounge
// de wellness sau masă la restaurant. Ritmul e cel de la catering, fiindcă
// prețul se stabilește de partener: cerere → ofertă → confirmare.
// Scrierea trece exclusiv prin RPC-uri; tabelul e read-only sub RLS.

export type BookingPurpose = "meeting" | "dining" | "wellness" | "event";

export type RequestBookingInput = {
  venueId: string;
  startsAt: string;
  endsAt: string;
  partySize: number;
  purpose: BookingPurpose;
  contactPerson: string;
  contactPhone: string;
  notes?: string;
};

/** Clientul cere un interval. Personalul locației primește o notificare. */
export async function requestVenueBooking(db: Db, input: RequestBookingInput): Promise<string> {
  const { data, error } = await db.rpc("request_venue_booking", {
    p_venue_id: input.venueId,
    p_starts_at: input.startsAt,
    p_ends_at: input.endsAt,
    p_party_size: input.partySize,
    p_purpose: input.purpose,
    p_contact_person: input.contactPerson,
    p_contact_phone: input.contactPhone,
    p_notes: input.notes,
  });
  if (error) throw new RpcError(error);
  return data as string;
}

/** Partenerul stabilește prețul intervalului cerut (staff-only la nivel de DB). */
export async function quoteVenueBooking(db: Db, bookingId: string, priceMdl: number): Promise<void> {
  const { error } = await db.rpc("quote_venue_booking", {
    p_booking_id: bookingId,
    p_price_mdl: priceMdl,
  });
  if (error) throw new RpcError(error);
}

/** Clientul acceptă oferta — abia acum intervalul e blocat. */
export async function confirmVenueBooking(db: Db, bookingId: string): Promise<void> {
  const { error } = await db.rpc("confirm_venue_booking", { p_booking_id: bookingId });
  if (error) throw new RpcError(error);
}

/** Partenerul refuză, cu motiv — clientul primește exact acest text. */
export async function declineVenueBooking(db: Db, bookingId: string, reason: string): Promise<void> {
  const { error } = await db.rpc("decline_venue_booking", {
    p_booking_id: bookingId,
    p_reason: reason,
  });
  if (error) throw new RpcError(error);
}

/** Clientul renunță la rezervarea proprie. */
export async function cancelVenueBooking(db: Db, bookingId: string): Promise<void> {
  const { error } = await db.rpc("cancel_venue_booking", { p_booking_id: bookingId });
  if (error) throw new RpcError(error);
}
