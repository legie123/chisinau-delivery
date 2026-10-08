import { supabase } from "./supabase";

// Contact block of one venue (web concierge/[slug]): read when the venue is opened.
// RLS restaurants_public_read (is_active = true) — same columns the web page reads anonymously.

export type VenueContact = { address: string | null; sector: string | null; phone: string | null; orderable: boolean };

/** Venue types that also deliver (web VENUE_META.orderable) — they get the menu link. */
const ORDERABLE = new Set(["restaurant", "sushi_bar"]);

export async function fetchVenueContact(id: string): Promise<VenueContact> {
  const { data, error } = await supabase
    .from("restaurants")
    .select("address, sector, phone, venue_type, accepting_orders")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return {
    address: data?.address ?? null,
    sector: data?.sector ?? null,
    phone: data?.phone ?? null,
    orderable: !!data && ORDERABLE.has(data.venue_type) && data.accepting_orders,
  };
}

/** tel: URL from a free-text phone ("+373 22 123 456" -> "tel:+37322123456"); null if no digits. */
export function telUrl(phone: string | null): string | null {
  const digits = (phone ?? "").replace(/[^\d+]/g, "");
  return /\d{3,}/.test(digits) ? `tel:${digits}` : null;
}
