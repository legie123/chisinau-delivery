import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type MenuSearchHit = {
  item_id: string;
  item_name: string;
  item_description: string | null;
  price_mdl: number;
  photo_url: string | null;
  restaurant_id: string;
  restaurant_slug: string;
  restaurant_name: string;
  cuisine_type: string;
};

// Cross-restaurant dish search (Bolt-Food-style mixed results): the customer
// browser hits this while typing so a query can surface dishes from
// restaurants whose name doesn't match, not just name/description filtering.
export async function GET(request: NextRequest) {
  // Cap the query length (audit #27) — a dish name is short; anything longer is
  // abuse. Slice instead of reject so the typeahead still returns something useful.
  const q = (request.nextUrl.searchParams.get("q")?.trim() ?? "").slice(0, 80);
  if (q.length < 2) {
    return NextResponse.json({ items: [] satisfies MenuSearchHit[] });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_menu_items", { p_query: q });
  if (error) {
    // Don't leak the raw Postgres error to the client (audit #27).
    console.error("menu-search rpc error:", error.message);
    return NextResponse.json({ error: "search unavailable" }, { status: 500 });
  }

  return NextResponse.json(
    { items: (data ?? []) as MenuSearchHit[] },
    { headers: { "Cache-Control": "s-maxage=20" } },
  );
}
