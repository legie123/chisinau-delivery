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
  const q = request.nextUrl.searchParams.get("q")?.trim() ?? "";
  if (q.length < 2) {
    return NextResponse.json({ items: [] satisfies MenuSearchHit[] });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("search_menu_items", { p_query: q });
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json(
    { items: (data ?? []) as MenuSearchHit[] },
    { headers: { "Cache-Control": "s-maxage=20" } },
  );
}
