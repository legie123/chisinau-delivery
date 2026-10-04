// Scenarios 4-5 and the settlement: catering quote-first, every exception path, then the money.
import {
  adminAssignCourier,
  adminGeneratePayouts,
  adminMarkPayoutPaid,
  adminReassignCourier,
  acceptOrder,
  advanceDeliveryStatus,
  cancelOrder,
  claimOrderAsCourier,
  confirmCateringQuote,
  declineDispatchOffer,
  acceptDispatchOffer,
  markReadyForPickup,
  placeOrder,
  recordCashOffload,
  rejectOrder,
  restaurantCancelOrder,
  submitCateringQuote,
} from "@chisinau/shared-api";
import { signViewerToken } from "@/lib/viewAs/token";
import { anonClient, check, fact, sleep, sql, stack, viewerClient, webSession } from "./harness";
import { Abort, balance, courierId, deliver, eq, goOnly, itemId, ledgerSum, liveOffer, memo, mustFail, offerId, oid, place, row, sees, step, type Actors } from "./flow";

const chisinauDate = (offsetDays = 0) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Chisinau" }).format(new Date(Date.now() + offsetDays * 86400_000));

export async function e4(A: Actors) {
  const S = "E4 · Catering (ofertă întâi) — cerere → ofertă → confirmare → livrare → încasat";
  const G = A.couriers.G;
  await goOnly(A, ["G"]);
  const b0 = balance(G);
  const l0 = ledgerSum(G);
  const eventDate = chisinauDate(1);
  const id = await step(S, "clientul cere catering (4× Set Sakura Deluxe, eveniment mâine 12:00, numerar)", () =>
    placeOrder(A.client.db, {
      restaurantId: "11111111-1111-1111-1111-111111111111",
      orderType: "catering",
      paymentMethod: "cash",
      items: [{ menu_item_id: itemId("Set Sakura Deluxe 40 piese"), quantity: 4 }],
      requestedFor: new Date(`${eventDate}T12:00:00+03:00`).toISOString(),
      notes: `E2E-${A.run}-E4`,
      catering: { event_date: eventDate, event_time: "12:00", guest_count: 20, event_address_text: "Str. Testelor 1, Chișinău", contact_person: "E2E Client", contact_phone: "+37360000000" },
    }),
  (i) => `comanda ${row(i).no}`);
  const quote = () => sql(`select quote_status from catering_details where order_id='${id}'`)[0][0];
  eq(S, "cererea e în așteptarea ofertei", `${row(id).status}/${quote()}`, "pending_restaurant/requested");
  await step(S, "restaurantul trimite oferta (3.800 MDL)", () => submitCateringQuote(A.partner.db, oid(id), 3800), () => `quote_status ${quote()}`);
  eq(S, "oferta e vizibilă ca „quoted”", quote(), "quoted");
  await step(S, "clientul confirmă oferta", () => confirmCateringQuote(A.client.db, oid(id)), () => `status ${row(id).status}`);
  eq(S, "comanda intră în fluxul standard", row(id).status, "accepted");
  await step(S, "restaurantul marchează „gata de ridicare”", () => markReadyForPickup(A.partner.db, oid(id)));
  await sleep(3000);
  const offers = sql(`select count(*) from dispatch_offers where order_id='${id}'`)[0][0];
  eq(S, "dispatch-ul NU oferă încă (comandă programată pe mâine)", offers, "0");
  await step(S, "masterul atribuie curierul G (evenimentul e mâine)", () => adminAssignCourier(A.admin.db, oid(id), courierId(G.id)), () => `status ${row(id).status}`);
  eq(S, "curierul G vede comanda", await sees(G.s, id), "true");
  await deliver(S, A, id, G, "G");
  const r = row(id);
  eq(S, "totalul = oferta confirmată (3800; livrarea e inclusă în ofertă, nu se adaugă)", r.total, 3800);
  check(S, "taxa curierului a fost calculată (tarif de rezervă pe distanță, fără adresă de livrare)", r.courierFee > 0, `${r.courierFee} MDL`);
  const delta = +(balance(G) - b0).toFixed(2);
  eq(S, "numerarul de la catering intră în float: exact oferta (3800)", delta, 3800);
  await step(S, "masterul înregistrează predarea numerarului", () => recordCashOffload(A.admin.db, courierId(G.id), delta, "E2E: predare numerar"));
  eq(S, "float-ul lui G revine la valoarea de dinainte (mișcări brute)", ledgerSum(G), l0);
  fact(S, "order", id);
}

async function cycle(A: Actors, S: string, tag: string) {
  return step(S, `comandă nouă (${tag})`, () => place(A, tag, { paymentMethod: "card_on_delivery", items: [{ menu_item_id: itemId("Rainbow Roll"), quantity: 1 }, { menu_item_id: itemId("Volcano Roll"), quantity: 1 }] }), (i) => `comanda ${row(i).no}`);
}

export async function e5(A: Actors) {
  const S = "E5 · Excepții — anulări, refuz, cascadă de oferte, reatribuire, cursă, „vezi ca”";
  const { R, N, G } = A.couriers;
  await goOnly(A, []);

  // (a) the client cancels before the restaurant answers
  const a = await cycle(A, S, "E5a");
  await step(S, "(a) clientul anulează înainte de acceptare", () => cancelOrder(A.client.db, oid(a), "E2E: m-am răzgândit"), () => `status ${row(a).status}`);
  eq(S, "(a) comanda e anulată", row(a).status, "cancelled");

  // (b) the restaurant refuses
  const b = await cycle(A, S, "E5b");
  await step(S, "(b) restaurantul refuză comanda", () => rejectOrder(A.partner.db, oid(b), "E2E: ingredient epuizat"), () => `status ${row(b).status}`);
  eq(S, "(b) comanda e refuzată", row(b).status, "rejected");

  // (c) too late to cancel once accepted; the restaurant can still cancel
  const c = await cycle(A, S, "E5c");
  await step(S, "(c) restaurantul acceptă", () => acceptOrder(A.partner.db, oid(c)));
  await mustFail(S, "(c) clientul nu mai poate anula după acceptare (mesaj în română)", () => cancelOrder(A.client.db, oid(c), "E2E: prea târziu"), /nu mai poate fi anulată/);
  await step(S, "(c) restaurantul anulează (motiv)", () => restaurantCancelOrder(A.partner.db, oid(c), "E2E: cuptor defect"), () => `status ${row(c).status}`);
  eq(S, "(c) comanda e anulată de restaurant", row(c).status, "cancelled");

  // (d) decline cascade R → N, then (e) the master reassigns N → G mid-delivery
  await goOnly(A, ["R", "N", "G"]);
  const d = await cycle(A, S, "E5d");
  await step(S, "(d) restaurantul acceptă + gata → oferta merge la cel mai apropiat (R)", async () => {
    await acceptOrder(A.partner.db, oid(d));
    await markReadyForPickup(A.partner.db, oid(d));
  });
  const offerR = await step(S, "(d) oferta e la R", () => liveOffer(R, d));
  await step(S, "(d) R refuză oferta", () => declineDispatchOffer(R.s.db, offerId(offerR)));
  const offerN = await step(S, "(d) oferta trece automat la N (cascadă)", () => liveOffer(N, d));
  await mustFail(S, "(d) R nu mai poate accepta oferta refuzată", () => acceptDispatchOffer(R.s.db, offerId(offerR)), /ofert/i);
  eq(S, "(d) oferta lui R e marcată refuzată în baza de date", sql(`select status from dispatch_offers where id='${offerR}'`)[0][0], "declined");
  await step(S, "(d) N acceptă oferta", () => acceptDispatchOffer(N.s.db, offerId(offerN)), () => `status ${row(d).status}`);
  eq(S, "(d) o singură ofertă acceptată pe comandă (a lui N)", sql(`select count(*) filter (where status='accepted' and courier_id='${N.id}'), count(*) filter (where status='accepted') from dispatch_offers where order_id='${d}'`)[0].join("/"), "1/1");
  await step(S, "(d) N ridică comanda", () => advanceDeliveryStatus(N.s.db, oid(d), "picked_up", false), () => row(d).status);
  await step(S, "(e) masterul reatribuie livrarea de la N la G", () => adminReassignCourier(A.admin.db, oid(d), courierId(G.id)), () => `status ${row(d).status}, curier ${row(d).courier === G.id ? "G" : "?"}`);
  eq(S, "(e) comanda aparține lui G", row(d).courier, G.id);
  eq(S, "(e) N nu mai vede comanda (RLS)", await sees(N.s, d), "false");
  await mustFail(S, "(e) N nu mai poate muta comanda (refuz de permisiune, nu eroare de rețea)", () => advanceDeliveryStatus(N.s.db, oid(d), "en_route", false), /permisiunea/);
  eq(S, "(e) comanda a rămas în starea dinaintea încercării lui N", row(d).status, "courier_assigned");
  await deliver(S, A, d, G, "G");

  // (f) race: two couriers claim the same waiting order
  await goOnly(A, []);
  const f = await cycle(A, S, "E5f");
  await step(S, "(f) comanda e gata, fără curier online", async () => {
    await acceptOrder(A.partner.db, oid(f));
    await markReadyForPickup(A.partner.db, oid(f));
  }, () => `status ${row(f).status}`);
  await mustFail(S, "(f) un curier OFFLINE nu poate prelua comanda din pool", () => claimOrderAsCourier(N.s.db, oid(f)), /pe online/);
  eq(S, "(f) comanda a rămas în pool după refuz", `${row(f).status}/${row(f).courier === ""}`, "ready_for_pickup/true");
  await goOnly(A, ["N", "G"]);
  const results = await Promise.allSettled([claimOrderAsCourier(N.s.db, oid(f)), claimOrderAsCourier(G.s.db, oid(f))]);
  const won = results.filter((x) => x.status === "fulfilled").length;
  const loser = results.find((x) => x.status === "rejected") as PromiseRejectedResult | undefined;
  check(S, "(f) cursă: exact un curier preia comanda", won === 1, `${won} reușite din 2`);
  check(S, "(f) pierzătorul primește „nu mai este disponibilă” (nu o altă eroare)", /nu mai este disponibilă/.test(String(loser?.reason?.userMessage ?? "")), `„${String(loser?.reason?.userMessage ?? "—")}”`);
  eq(S, "(f) câștigătorul din răspunsuri = curierul din baza de date", row(f).courier, results[0].status === "fulfilled" ? N.id : G.id);
  if (row(f).courier === "") await step(S, "(f) fallback: masterul atribuie", () => adminAssignCourier(A.admin.db, oid(f), courierId(N.id)));
  const fin = row(f).courier === G.id ? G : N;
  await deliver(S, A, f, fin, fin === G ? "G" : "N");

  // (g) master "vezi ca" — read-only, audited, revoked on exit
  const target = A.client.userId;
  const sid = await step(S, "(g) masterul pornește „vezi ca” pe client", async () => {
    const { data, error } = await A.admin.db.rpc("start_view_as", { p_target: target, p_app: "client", p_reason: "E2E: verificare flux" });
    if (error) throw new Error(error.message);
    return data as string;
  }, (s) => `sesiune ${s.slice(0, 8)}`);
  const token = signViewerToken({ target, admin: A.admin.userId, session: sid, app: "client" }, stack.JWT_SECRET);
  const viewer = viewerClient(token);
  const seen = await viewer.from("orders").select("id").eq("id", memo.e1).maybeSingle();
  check(S, "(g) „vezi ca” (tokenul REAL al app-ului) vede comenzile clientului", !!seen.data, seen.error?.message ?? "comanda E1 vizibilă");
  const foreign = await viewer.from("orders").select("id").neq("customer_id", target).limit(5);
  check(S, "(g) „vezi ca” nu vede nicio comandă a altui client", !foreign.error && (foreign.data ?? []).length === 0, foreign.error?.message ?? `${(foreign.data ?? []).length} rânduri străine`);
  const gotrue = await fetch(`${stack.API_URL}/auth/v1/user`, { headers: { apikey: stack.ANON_KEY, Authorization: `Bearer ${token}` } });
  check(S, "(g) GoTrue refuză tokenul „vezi ca” (nu poate schimba contul clientului)", gotrue.status === 401 || gotrue.status === 403, `HTTP ${gotrue.status}`);
  await mustFail(S, "(g) „vezi ca” NU poate plasa comenzi (doar citire)", () => placeOrder(viewer, { restaurantId: "11111111-1111-1111-1111-111111111111", orderType: "standard", paymentMethod: "cash", items: [{ menu_item_id: itemId("Rainbow Roll"), quantity: 1 }] }), /permisiunea/);
  const upd = await viewer.from("orders").update({ notes: "hack" }).eq("customer_id", target).select("id");
  check(S, "(g) „vezi ca” NU poate modifica comenzi", !!upd.error || (upd.data ?? []).length === 0, upd.error?.message ?? "0 rânduri modificate");
  await step(S, "(g) masterul iese din „vezi ca” (sesiune închisă)", async () => {
    const { error } = await A.admin.db.rpc("end_view_as", { p_session: sid });
    if (error) throw new Error(error.message);
  });
  const after = await viewer.from("orders").select("id").limit(5);
  check(S, "(g) după „Ieși” tokenul nu mai citește nimic", (after.data ?? []).length === 0, `${(after.data ?? []).length} rânduri`);
  eq(S, "(g) sesiunea e în audit", sql(`select count(*) from view_as_sessions where id='${sid}' and ended_at is not null`)[0][0], "1");

  // (h) an anonymous visitor (public anon key + a leaked order id) can touch nothing
  const anon = anonClient();
  const victim = memo.e1;
  const before = row(victim);
  // 42501 = the GRANT itself is gone (the first layer); a body-level "not authorized" would be the second layer alone.
  const tip = await anon.rpc("set_order_tip", { p_order_id: victim, p_tip_mdl: 777 });
  check(S, "(h) anonim: set_order_tip refuzat de GRANT (42501)", tip.error?.code === "42501", tip.error ? `${tip.error.code} ${tip.error.message}` : "a reușit");
  const pay = await anon.rpc("start_online_payment", { p_order_id: victim });
  check(S, "(h) anonim: start_online_payment refuzat de GRANT (42501)", pay.error?.code === "42501", pay.error ? `${pay.error.code} ${pay.error.message}` : "a reușit");
  const peek = await anon.from("orders").select("id").eq("id", victim);
  check(S, "(h) anonim: nu citește nicio comandă", !peek.error && (peek.data ?? []).length === 0, `${(peek.data ?? []).length} rânduri`);
  const intact = row(victim);
  eq(S, "(h) comanda victimă a rămas neatinsă (bacșiș, total, plată)", `${intact.tip}/${intact.total}/${intact.pay}`, `${before.tip}/${before.total}/${before.pay}`);
}

/** Settlement: payouts for every delivered E2E order, to the ban, then frozen. */
export async function settlement(A: Actors, startedAt: string) {
  const S = "S · Decontare — plăți restaurant + curier pentru toate comenzile livrate";
  const delivered = sql(`select id from orders where notes like 'E2E-${A.run}-%' and status='delivered'`).map((r) => r[0]);
  fact(S, "delivered_orders", delivered.length);
  const day = chisinauDate();
  // The generator is global per period: it would also settle (irreversibly) anyone else's unpaid delivered
  // orders of the day. Refuse to run then, unless explicitly asked.
  const foreign = +sql(`select count(*) from orders o where o.status='delivered' and o.payment_status='paid' and o.courier_id is not null and (o.delivered_at at time zone 'Europe/Chisinau')::date='${day}' and o.notes not like 'E2E-%' and not exists (select 1 from payout_orders po where po.order_id=o.id)`)[0][0];
  if (foreign > 0 && process.env.E2E_SETTLE_ALL !== "1") {
    check(S, "nu există comenzi livrate și neplătite din afara testului (decontarea e globală)", false, `${foreign} comenzi străine ar fi plătite irevocabil — rulează cu E2E_SETTLE_ALL=1 doar dacă vrei asta`);
    throw new Abort(S);
  }
  const made = await step(S, `masterul generează plățile pentru ${day}`, () => adminGeneratePayouts(A.admin.db, day, day), (n) => `${n} plăți create`);
  check(S, "s-au creat plăți", made > 0, `${made}`);
  const [bad] = sql(`
    with o as (select o.*, pc.restaurant_commission_pct rp, pc.courier_commission_pct cp from orders o left join lateral public.pricing_config_at(o.delivered_at) pc on true
               where o.notes like 'E2E-${A.run}-%' and o.status='delivered'),
    x as (select id, 'restaurant' rt, case when order_type='standard' then subtotal_mdl else greatest(total_mdl-delivery_fee_mdl-coalesce(tip_mdl,0),0) end gross, rp pct, case when order_type='standard' then subtotal_mdl else greatest(total_mdl-delivery_fee_mdl-coalesce(tip_mdl,0),0) end base from o
          union all select id, 'courier', coalesce(courier_fee_mdl,delivery_fee_mdl)+coalesce(tip_mdl,0), cp, coalesce(courier_fee_mdl,delivery_fee_mdl) from o)
    select count(*) filter (where po.order_id is null), count(*) filter (where po.order_id is not null and (po.gross_mdl<>x.gross or po.net_mdl<>x.gross-round(x.base*x.pct/100,2))), count(*) from x left join public.payout_orders po on po.order_id=x.id and po.recipient_type=x.rt`);
  eq(S, `fiecare comandă livrată are 2 linii de plată (restaurant + curier): ${bad[2]} așteptate`, bad[0], "0", " lipsă");
  eq(S, "sumele pe linii = formula (comision la momentul livrării, bacșiș 100% curier)", bad[1], "0", " greșite");
  const [hdr] = sql(`select count(*) filter (where p.net_mdl <> coalesce(l.net,0) or p.orders_count <> coalesce(l.n,0) or p.gross_mdl <> coalesce(l.gross,0)), count(*) from public.payouts p left join (select payout_id, sum(net_mdl) net, sum(gross_mdl) gross, count(*) n from public.payout_orders group by 1) l on l.payout_id=p.id where p.created_at >= '${startedAt}'`);
  eq(S, `antetul fiecărei plăți = suma liniilor (net, brut, număr de comenzi; ${hdr[1]} plăți)`, hdr[0], "0", " diferențe");
  const paid = sql(`select id from public.payouts where created_at >= '${startedAt}' and status='pending'`).map((r) => r[0]);
  for (const p of paid) await adminMarkPayoutPaid(A.admin.db, p);
  eq(S, "masterul marchează plățile ca achitate", sql(`select count(*) from public.payouts where created_at >= '${startedAt}' and status='paid'`)[0][0], paid.length);
  eq(S, "a doua generare nu plătește nimic de două ori", await adminGeneratePayouts(A.admin.db, day, day), 0);
  const refused = (q: string, re = /ledger-ul de payout este imutabil/) => {
    try {
      sql(`begin; ${q}; rollback;`);
      return false;
    } catch (e) {
      return re.test(String(e));
    }
  };
  const line = sql(`select payout_id, recipient_type from payout_orders where order_id='${delivered[0]}' limit 1`)[0];
  const other = delivered[1] ?? delivered[0];
  check(S, "ledger înghețat: UPDATE pe o linie plătită e refuzat", refused(`update public.payout_orders set net_mdl = net_mdl + 1 where order_id = '${delivered[0]}'`));
  check(S, "ledger înghețat: DELETE pe o linie plătită e refuzat", refused(`delete from public.payout_orders where order_id = '${delivered[0]}'`));
  check(S, "ledger înghețat: INSERT într-o plată achitată e refuzat", refused(`insert into public.payout_orders (payout_id, order_id, recipient_type, gross_mdl, net_mdl) values ('${line[0]}', '${other}', '${line[1] === "courier" ? "restaurant" : "courier"}', 1, 1)`));
  check(S, "ledger înghețat: ștergerea unei comenzi decontate e refuzată (nu mai dispar liniile în cascadă)", refused(`delete from public.orders where id = '${delivered[0]}'`));
  check(S, "ledger înghețat: ștergerea antetului unei plăți achitate e refuzată", refused(`delete from public.payouts where id = '${line[0]}'`, /un payout plătit este imutabil/));
  const open = sql(`select count(*) from orders where notes like 'E2E-${A.run}-%' and status not in ('delivered','cancelled','rejected')`)[0][0];
  eq(S, "nicio comandă de test nu a rămas blocată într-o stare deschisă", open, "0");
  const paidHtml = await (await webSession("platform"))("/platform/payouts");
  check(S, "pagina masterului /platform/payouts arată plățile ca achitate", paidHtml.status === 200 && (paidHtml.html.match(/Plătit/g) ?? []).length >= paid.length, `${(paidHtml.html.match(/Plătit/g) ?? []).length} × „Plătit”, ${paid.length} plăți noi`);
  const earn = await (await webSession("restaurant"))("/restaurant/earnings");
  check(S, "pagina restaurantului /restaurant/earnings arată decontările achitate", earn.status === 200 && /Plătit/.test(earn.html), `HTTP ${earn.status}`);
  for (const k of ["R", "N", "G"] as const) eq(S, `float-ul curierului ${k} e la fel ca înainte de test`, balance(A.couriers[k]), memo[`float${k}`]);
}
