// Gate 2 — differential price test: shown (app math) == charged (orders.total_mdl) == ledger
// (courier_cash_movements 'collected' for cash). For N seeded cases over every orderable
// restaurant (modifiers, quantities, every tip mode, cash and card on delivery) the app's own
// functions compute what CartScreen shows; one SQL script then places each order through
// place_order (with p_expected_total), set_order_tip, delivers it via advance_delivery_status
// and asserts the three numbers. Every 5th case changes the delivery fee between "display" and
// the tap and must be REFUSED. The whole script runs in BEGIN … ROLLBACK: nothing is kept.
// Run: npm run test:price   (local stack; PRICE_DIFF_CASES=N, PRICE_DIFF_SEED=S)
import { execFileSync, spawnSync } from "node:child_process";
import {
  EMPTY_CART,
  addToCart,
  cartSubtotal,
  chosenOptions,
  type CartState,
  type OptionGroupLike,
  type Selection,
} from "@chisinau/shared-domain";
import { CASH_CAP_MDL, TIP_PCT, buildOrderInput, checkoutTotals, tipFor, tipProblem, type TipChoice } from "../src/lib/checkout";

const DB = "supabase_db_chisinau-delivery";
const CUSTOMER = "a0000000-0000-0000-0000-000000000001";
const COURIER_USER = "a0000000-0000-0000-0000-000000000002";

function psql(sql: string, json = false): string {
  return execFileSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", ...(json ? ["-At"] : [])], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

type Item = { id: string; name: string; price_mdl: number; groups: OptionGroupLike[] };
type Rest = { id: string; name: string; delivery_fee_mdl: number; min_order_amount_mdl: number; items: Item[] };

function catalog(): Rest[] {
  const out = psql(
    `select coalesce(json_agg(r), '[]') from (
       select r.id, r.name, r.delivery_fee_mdl::float8, r.min_order_amount_mdl::float8,
         (select coalesce(json_agg(json_build_object('id', mi.id, 'name', mi.name, 'price_mdl', mi.price_mdl::float8,
            'groups', (select coalesce(json_agg(json_build_object('id', g.id, 'name', g.name, 'is_required', g.is_required,
                        'min_select', g.min_select, 'max_select', g.max_select,
                        'options', (select coalesce(json_agg(json_build_object('id', o.id, 'name', o.name,
                                     'price_delta_mdl', o.price_delta_mdl::float8, 'is_available', o.is_available) order by o.sort_order), '[]')
                                    from public.menu_options o where o.group_id = g.id))
                       order by g.sort_order), '[]') from public.menu_option_groups g where g.menu_item_id = mi.id))
            order by mi.price_mdl), '[]')
          from public.menu_items mi
          where mi.restaurant_id = r.id and mi.is_available and not mi.is_catering_only
            and (mi.sold_out_until is null or mi.sold_out_until <= now())) as items
       from public.restaurants r
       where r.is_active and r.venue_type in ('restaurant', 'sushi_bar')
       order by r.name) r;`,
    true,
  );
  return (JSON.parse(out.trim()) as Rest[]).filter((r) => r.items.length > 0);
}

// Deterministic PRNG (mulberry32) so a failing case can be replayed with the same seed.
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Case = {
  n: number;
  rest: Rest;
  cart: CartState;
  payment: "cash" | "card_on_delivery";
  tip: number;
  shownTotal: number;
  expectedTotal: number;
  drift: boolean;
};

function buildCases(rests: Rest[], count: number, seed: number): Case[] {
  const rand = rng(seed);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const tipModes: (TipChoice | "custom")[] = ["none", "p10", "p15", "p20", "custom"];
  const cases: Case[] = [];
  for (let n = 1; n <= count; n++) {
    const rest = rests[(n - 1) % rests.length];
    let cart: CartState = EMPTY_CART;
    const lines = 1 + Math.floor(rand() * 3);
    for (let l = 0; l < lines; l++) {
      // Half the lines take an item with modifiers when the menu has any (modifier pricing is the risky part).
      const withGroups = rest.items.filter((i) => i.groups.length > 0);
      const item = withGroups.length > 0 && rand() < 0.5 ? pick(withGroups) : pick(rest.items);
      const selection: Selection = {};
      for (const g of item.groups) {
        const avail = g.options.filter((o) => o.is_available);
        if (avail.length === 0) continue;
        const want = g.is_required ? Math.max(1, g.min_select ?? 1) : rand() < 0.5 ? 0 : 1;
        const k = Math.min(want, g.max_select ?? want, avail.length);
        if (k > 0) selection[g.id] = [...avail].sort(() => rand() - 0.5).slice(0, k).map((o) => o.id);
      }
      if (item.groups.some((g) => g.is_required && !selection[g.id])) continue;
      const options = item.groups.length ? chosenOptions(item, item.groups, selection) : undefined;
      cart = addToCart(cart, rest, item, options, 1 + Math.floor(rand() * 3));
    }
    if (cart.lines.length === 0) continue;
    // Reach the minimum order the way a customer would: more of the first line.
    while (cartSubtotal(cart.lines) < rest.min_order_amount_mdl) {
      cart = { ...cart, lines: cart.lines.map((l, i) => (i === 0 ? { ...l, quantity: l.quantity + 1 } : l)) };
    }
    const subtotal = cartSubtotal(cart.lines);
    let payment: Case["payment"] = rand() < 0.6 ? "cash" : "card_on_delivery";
    if (payment === "cash" && subtotal + rest.delivery_fee_mdl > CASH_CAP_MDL) payment = "card_on_delivery";
    const mode = pick(tipModes);
    let tip = mode === "custom" ? tipFor(subtotal, "none", String(1 + Math.floor(rand() * 120))) : tipFor(subtotal, mode, "");
    if (tipProblem(subtotal, tip)) tip = 0; // the app blocks the button; the case is the no-tip one
    const t = checkoutTotals(cart.lines, rest.delivery_fee_mdl, tip);
    cases.push({ n, rest, cart, payment, tip: t.tip, shownTotal: t.total, expectedTotal: t.expectedTotal, drift: n % 5 === 0 });
  }
  void TIP_PCT;
  return cases;
}

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;

function caseSql(c: Case): string {
  const input = buildOrderInput(c.cart, {
    deliveryAddressId: "00000000-0000-0000-0000-000000000000",
    paymentMethod: c.payment,
    idempotencyKey: `price-diff-${c.n}`,
    deliveryFeeMdl: c.rest.delivery_fee_mdl,
  });
  const claims = (sub: string) => q(JSON.stringify({ sub, role: "authenticated" }));
  const place = `public.place_order(p_restaurant_id => ${q(input.restaurantId)}, p_order_type => 'standard',
      p_payment_method => ${q(input.paymentMethod)}, p_items => ${q(JSON.stringify(input.items))}::jsonb,
      p_delivery_address_id => (select id from pg_temp.addr), p_idempotency_key => ${q(input.idempotencyKey!)},
      p_expected_total => ${input.expectedTotalMdl})`;
  if (c.drift) {
    return `do $$ begin
  update public.restaurants set delivery_fee_mdl = delivery_fee_mdl + 7 where id = ${q(c.rest.id)};
  perform set_config('request.jwt.claims', ${claims(CUSTOMER)}, true);
  begin
    perform ${place};
    raise exception 'FAIL case ${c.n}: placed although the fee changed after display';
  exception when raise_exception then
    if sqlerrm like 'FAIL%' or sqlerrm not like 'prețul s-a schimbat%' then raise; end if;
  end;
  perform set_config('request.jwt.claims', null, true);
  update public.restaurants set delivery_fee_mdl = delivery_fee_mdl - 7 where id = ${q(c.rest.id)};
  raise notice 'CASE ${c.n} drift refused (shown ${c.shownTotal.toFixed(2)})';
end $$;`;
  }
  return `do $$ declare v_oid uuid; v_total numeric; v_coll numeric; v_courier uuid;
begin
  select id into v_courier from public.couriers where user_id = ${q(COURIER_USER)};
  perform set_config('request.jwt.claims', ${claims(CUSTOMER)}, true);
  v_oid := ${place};
  ${c.tip > 0 ? `perform public.set_order_tip(v_oid, ${c.tip});` : ""}
  perform set_config('request.jwt.claims', null, true);
  update public.orders set courier_id = v_courier, status = 'en_route' where id = v_oid;
  perform set_config('request.jwt.claims', ${claims(COURIER_USER)}, true);
  perform public.advance_delivery_status(v_oid, 'delivered', true);
  perform set_config('request.jwt.claims', null, true);
  select total_mdl into v_total from public.orders where id = v_oid;
  select coalesce(sum(amount_mdl), 0) into v_coll from public.courier_cash_movements where order_id = v_oid and kind = 'collected';
  if v_total <> ${c.shownTotal.toFixed(2)} then
    raise exception 'FAIL case ${c.n} (${c.payment}, tip ${c.tip}): shown ${c.shownTotal.toFixed(2)} but charged %', v_total;
  end if;
  if ${c.payment === "cash" ? `v_coll <> ${c.shownTotal.toFixed(2)}` : "v_coll <> 0"} then
    raise exception 'FAIL case ${c.n} (${c.payment}): ledger collected % for shown ${c.shownTotal.toFixed(2)}', v_coll;
  end if;
  raise notice 'CASE ${c.n} ok ${c.payment} lines=${c.cart.lines.length} tip=${c.tip} shown=charged=${c.shownTotal.toFixed(2)} ledger=%', v_coll;
end $$;`;
}

export async function main() {
  const count = Number(process.env.PRICE_DIFF_CASES ?? 40);
  const seed = Number(process.env.PRICE_DIFF_SEED ?? 20261012);
  const rests = catalog();
  if (rests.length === 0) throw new Error("price-diff: no orderable restaurant");
  const cases = buildCases(rests, count, seed);
  const ids = [...new Set(cases.map((c) => c.rest.id))];
  const setup = `
create temp table addr on commit drop as
  select id from public.addresses where customer_id = ${q(CUSTOMER)} order by created_at limit 1;
do $$ begin if not exists (select 1 from pg_temp.addr) then raise exception 'FAIL: test customer has no address'; end if; end $$;
delete from public.restaurant_hours where restaurant_id in (${ids.map(q).join(",")});
insert into public.restaurant_hours (restaurant_id, day_of_week, opens_at, closes_at, is_closed)
  select r, d, '00:00'::time, '00:00'::time, false from unnest(array[${ids.map(q).join(",")}]::uuid[]) r, generate_series(0, 6) d;
update public.restaurants set accepting_orders = true where id in (${ids.map(q).join(",")});`;
  const sql = ["BEGIN;", setup, ...cases.map(caseSql), "ROLLBACK;"].join("\n");
  let out = "";
  let ok = true;
  // psql writes NOTICEs (the per-case lines) to stderr: keep both streams.
  const run = spawnSync("docker", ["exec", "-i", DB, "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1"], {
    input: sql,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  ok = run.status === 0;
  out = `${run.stdout}\n${run.stderr}`;
  const lines = out.split("\n").filter((l) => /CASE|FAIL|ERROR/.test(l));
  const result = {
    seed,
    cases: cases.length,
    restaurants: ids.length,
    drift: cases.filter((c) => c.drift).length,
    cash: cases.filter((c) => !c.drift && c.payment === "cash").length,
    card: cases.filter((c) => !c.drift && c.payment === "card_on_delivery").length,
    withTip: cases.filter((c) => c.tip > 0).length,
    withOptions: cases.filter((c) => c.cart.lines.some((l) => l.optionIds.length > 0)).length,
    passed: lines.filter((l) => l.includes("CASE")).length,
    failures: lines.filter((l) => /FAIL|ERROR/.test(l)),
  };
  ok = ok && result.passed === cases.length && result.failures.length === 0;
  return { ok, result };
}
