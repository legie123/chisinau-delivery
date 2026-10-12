// Smoke against a REAL Supabase (local by default): signs in as the test customer and
// places an order through @chisinau/shared-api placeOrder with the payload built by
// src/lib/checkout.buildOrderInput — the exact function CartScreen calls. Proves:
//   1. the payload shape is accepted by place_order (incl. option_ids when the item has
//      a required modifier group),
//   2. the server's re-priced subtotal == the app's cart math (shared-domain/cart),
//   3. the idempotency key works (a retry returns the SAME order id),
//   4. cancelOrder works for the customer while pending.
// Leaves a CANCELLED order + its address; the runner prints their ids for cleanup.
// Run: npm run smoke:order   (env: SUPABASE_URL, SUPABASE_ANON_KEY, or read from `supabase status`)
import { createClient } from "@supabase/supabase-js";
import { cancelOrder, placeOrder } from "@chisinau/shared-api";
import type { Database } from "@chisinau/shared-types";
import { EMPTY_CART, addToCart, cartSubtotal, chosenOptions, type OptionGroupLike, type Selection } from "@chisinau/shared-domain";
import { buildOrderInput, newIdempotencyKey } from "../src/lib/checkout";

function must<T>(v: T | null | undefined, what: string): T {
  if (v == null) throw new Error(`smoke: ${what}`);
  return v;
}

export async function main(env: { url: string; anonKey: string; email: string; password: string }) {
  const db = createClient<Database>(env.url, env.anonKey, { auth: { persistSession: false } });
  const { data: auth, error: authError } = await db.auth.signInWithPassword({ email: env.email, password: env.password });
  if (authError) throw new Error(`sign-in failed: ${authError.message}`);
  const userId = must(auth.user?.id, "no user");

  // An open, ordering restaurant — prefer an item WITH a required option group.
  const { data: restaurants } = await db
    .from("restaurants")
    .select("id, name, min_order_amount_mdl, delivery_fee_mdl, lat, lng")
    .eq("is_active", true)
    .eq("accepting_orders", true)
    .in("venue_type", ["restaurant", "sushi_bar"]);
  let picked: { r: { id: string; name: string; min_order_amount_mdl: number; delivery_fee_mdl: number; lat: number | null; lng: number | null }; item: { id: string; name: string; price_mdl: number }; groups: OptionGroupLike[] } | null = null;
  for (const r of restaurants ?? []) {
    const { data: open } = await db.rpc("restaurant_open_at", { p_restaurant_id: r.id, p_at: new Date().toISOString() });
    if (open === false) continue;
    const { data: items } = await db
      .from("menu_items")
      .select("id, name, price_mdl")
      .eq("restaurant_id", r.id)
      .eq("is_available", true)
      .eq("is_catering_only", false)
      .order("price_mdl", { ascending: false });
    for (const item of items ?? []) {
      const { data: groups } = await db
        .from("menu_option_groups")
        .select("id, name, is_required, min_select, max_select, menu_options(id, name, price_delta_mdl, is_available)")
        .eq("menu_item_id", item.id);
      const g = (groups ?? []).map((x) => ({ ...x, options: x.menu_options ?? [] }));
      if (!picked || (g.some((x) => x.is_required) && picked.groups.length === 0)) picked = { r, item, groups: g };
      if (g.some((x) => x.is_required)) break;
    }
    if (picked?.groups.length) break;
  }
  const { r, item, groups } = must(picked, "no open restaurant with an orderable item");

  // Choose the first available option of every required group (and nothing else).
  const selection: Selection = {};
  for (const g of groups) if (g.is_required) selection[g.id] = [must(g.options.find((o) => o.is_available), `no option in ${g.name}`).id];
  const options = groups.length ? chosenOptions(item, groups, selection) : undefined;
  const unit = options?.unitPriceMdl ?? Number(item.price_mdl);
  // Reach the minimum order, stay under the 1400 MDL cash cap.
  const qty = Math.max(1, Math.ceil(Number(r.min_order_amount_mdl) / unit));
  if (unit * qty > 1400) throw new Error(`smoke: ${item.name} x${qty} exceeds the cash cap — pick another fixture`);
  const cart = addToCart(EMPTY_CART, r, item, options, qty);

  const { data: address, error: addrError } = await db
    .from("addresses")
    // place_order needs a pin inside the delivery radius (C1): pin the address next to the restaurant.
    .insert({ customer_id: userId, street_address: "Smoke test, str. Ștefan cel Mare 1", contact_phone: "+37360000000", lat: Number(r.lat) + 0.001, lng: Number(r.lng) })
    .select("id")
    .single();
  if (addrError) throw new Error(`address insert failed: ${addrError.message}`);

  const key = newIdempotencyKey();
  const input = buildOrderInput(cart, { deliveryAddressId: address.id, paymentMethod: "cash", idempotencyKey: key, deliveryFeeMdl: Number(r.delivery_fee_mdl) });
  const orderId = await placeOrder(db, input);
  const retryId = await placeOrder(db, input); // same key -> same order, no duplicate

  const { data: order } = await db.from("orders").select("status, subtotal_mdl, order_number").eq("id", orderId).single();
  await cancelOrder(db, orderId, "Smoke test mobile/client — anulată automat");
  const { data: after } = await db.from("orders").select("status").eq("id", orderId).single();

  const result = {
    restaurant: r.name,
    item: item.name,
    optionIds: input.items[0].option_ids,
    payloadItems: input.items,
    clientSubtotal: cartSubtotal(cart.lines),
    serverSubtotal: Number(order?.subtotal_mdl),
    statusAfterPlace: order?.status,
    idempotentRetrySameId: retryId === orderId,
    statusAfterCancel: after?.status,
    orderId,
    addressId: address.id,
  };
  const ok =
    result.idempotentRetrySameId &&
    result.statusAfterPlace === "pending_restaurant" &&
    result.statusAfterCancel === "cancelled" &&
    Math.abs(result.clientSubtotal - result.serverSubtotal) < 0.005;
  return { ok, result };
}
