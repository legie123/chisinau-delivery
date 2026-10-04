// UI shapes for the client app. Built from Supabase rows in src/lib/api.ts.
import type { OptionGroupLike } from "@chisinau/shared-domain";

export interface Restaurant {
  id: string;
  slug: string;
  name: string;
  cuisine: string;
  venueType: string;
  category: string;
  address: string;
  lat: number | null;
  lng: number | null;
  logoUrl: string | null;
  coverUrl: string | null;
  ratingAvg: number | null;
  ratingCount: number;
  prepLabel: string; // "25–40 min" from get_prep_estimates (static fallback)
  deliveryFee: number;
  minOrder: number;
  acceptingOrders: boolean;
  openNow: boolean;
  nextOpening: string | null;
  distanceM: number | null;
  acceptsCatering: boolean;
  cateringMin: number | null;
}

export interface MenuItem {
  id: string;
  restaurantId: string;
  name: string;
  description: string;
  priceMdl: number;
  imageUrl: string | null;
  category: string;
  cateringMinQty: number | null;
}

export type OptionGroup = OptionGroupLike & { menuItemId: string };
