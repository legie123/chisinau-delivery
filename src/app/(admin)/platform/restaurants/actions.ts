"use server";

import { revalidatePath } from "next/cache";
import { mapPgError, authErrorText } from "@chisinau/shared-api";
import { requirePlatformAdmin } from "@/lib/auth/require";
import { createAdminClient } from "@/lib/supabase/admin";
import { geocodeAddress } from "@/lib/geo/geocode";
import type { CuisineType } from "@/lib/types/domain";

export type ActionState = { error: string | null; notice?: string };

export async function createRestaurant(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase } = await requirePlatformAdmin();

    const name = String(formData.get("name") ?? "").trim();
    const slug = String(formData.get("slug") ?? "").trim();
    const cuisineType = String(formData.get("cuisine_type") ?? "other") as CuisineType;
    const address = String(formData.get("address") ?? "").trim();
    const sector = String(formData.get("sector") ?? "").trim() || null;
    const phone = String(formData.get("phone") ?? "").trim();
    const deliveryFee = Number(formData.get("delivery_fee_mdl") ?? 0);
    const minOrder = Number(formData.get("min_order_amount_mdl") ?? 0);

    if (!name || !slug || !address || !phone) {
      return { error: "Nume, slug, adresă și telefon sunt obligatorii." };
    }

    // Auto-geocode the address so dispatch + nearby-browse use the REAL position
    // (not the 6 km fallback). Failure NEVER blocks creation — the restaurant is
    // saved without coordinates and the operator is told to set them later.
    const geo = await geocodeAddress(address);

    const { error } = await supabase.from("restaurants").insert({
      name,
      slug,
      cuisine_type: cuisineType,
      address,
      sector,
      phone,
      delivery_fee_mdl: deliveryFee,
      min_order_amount_mdl: minOrder,
      lat: geo?.lat ?? null,
      lng: geo?.lng ?? null,
    });

    if (error) return { error: mapPgError(error) };

    revalidatePath("/platform/restaurants");
    return {
      error: null,
      notice: geo
        ? `Restaurant creat. Adresă geolocalizată: ${geo.lat.toFixed(5)}, ${geo.lng.toFixed(5)}.`
        : "Restaurant creat, dar adresa nu a putut fi geolocalizată automat — setează coordonatele manual înainte de activare.",
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

export async function invitePartner(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { user: actor } = await requirePlatformAdmin();

    const restaurantId = String(formData.get("restaurant_id") ?? "");
    const email = String(formData.get("email") ?? "").trim();
    const fullName = String(formData.get("full_name") ?? "").trim();

    if (!restaurantId || !email || !fullName) {
      return { error: "Restaurant, email și nume sunt obligatorii." };
    }

    const admin = createAdminClient(actor.id);

    const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
      data: { full_name: fullName, role: "restaurant_partner" },
    });
    if (inviteError) return { error: authErrorText(inviteError) };

    const userId = invited.user.id;

    // The customer-signup trigger only provisions profiles for role=customer,
    // so admin-invited roles need their profile + staff link created explicitly.
    const { error: profileError } = await admin
      .from("profiles")
      .insert({ id: userId, full_name: fullName, role: "restaurant_partner" });
    if (profileError) return { error: mapPgError(profileError) };

    const { error: staffError } = await admin
      .from("restaurant_staff")
      .insert({ restaurant_id: restaurantId, user_id: userId });
    if (staffError) return { error: mapPgError(staffError) };

    revalidatePath("/platform/restaurants");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

// Set a restaurant's real coordinates — the missing operability hop for
// restaurants onboarded via the self-signup RPC (review_onboarding_application
// can't call the JS geocoder, so those land with lat/lng NULL and dispatch/ETA
// fall back to a 6 km default). Admin either geocodes from the stored address
// (Nominatim) or pastes lat/lng from Google Maps. Admin session is the authorized
// path for lat/lng (guard_restaurant_platform_columns allows it only for admins).
export async function setRestaurantLocation(
  restaurantId: string,
  manual?: { lat: number; lng: number },
): Promise<ActionState> {
  try {
    const { supabase } = await requirePlatformAdmin();

    let lat: number;
    let lng: number;
    let notice: string;

    if (manual && Number.isFinite(manual.lat) && Number.isFinite(manual.lng)) {
      // Same Moldova-bounds sanity as the geocoder, so a typo can't send dispatch
      // to the wrong country.
      if (manual.lat < 45.4 || manual.lat > 48.5 || manual.lng < 26.6 || manual.lng > 30.2) {
        return { error: "Coordonatele par în afara Moldovei — verifică-le." };
      }
      lat = manual.lat;
      lng = manual.lng;
      notice = `Coordonate setate manual: ${lat.toFixed(5)}, ${lng.toFixed(5)}.`;
    } else {
      const { data: rest } = await supabase
        .from("restaurants")
        .select("address")
        .eq("id", restaurantId)
        .single();
      const geo = rest?.address ? await geocodeAddress(rest.address) : null;
      if (!geo) {
        return {
          error: "Adresa nu a putut fi geolocalizată automat. Setează coordonatele manual (le iei din Google Maps).",
        };
      }
      lat = geo.lat;
      lng = geo.lng;
      notice = `Geolocalizat din adresă: ${lat.toFixed(5)}, ${lng.toFixed(5)}.`;
    }

    const { error } = await supabase.from("restaurants").update({ lat, lng }).eq("id", restaurantId);
    if (error) return { error: mapPgError(error) };

    revalidatePath("/platform/restaurants");
    return { error: null, notice };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

// Activate / deactivate a restaurant (the platform moderation flag). An onboarded
// restaurant is created is_active=false and is invisible + order-blocked until an
// admin flips this — the missing last hop of the onboarding organism. The
// guard_restaurant_platform_columns trigger allows is_active writes only for a
// platform_admin, so this admin-session update is the authorized path.
export async function setRestaurantActive(restaurantId: string, isActive: boolean): Promise<ActionState> {
  try {
    const { supabase } = await requirePlatformAdmin();
    const { error } = await supabase.from("restaurants").update({ is_active: isActive }).eq("id", restaurantId);
    if (error) return { error: mapPgError(error) };
    revalidatePath("/platform/restaurants");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}
