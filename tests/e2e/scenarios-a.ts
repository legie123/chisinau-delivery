// Scenarios 1-3: the standard order, end to end, across client / restaurant / courier / master.
import { adminCourierCashStatus, recordCashOffload, setOrderTip, submitRating } from "@chisinau/shared-api";
import { check, fact, sql, webSession } from "./harness";
import { balance, courierId, courierSeenBy, deliver, eq, goOnly, itemId, ledgerSum, memo, mustFail, oid, optionId, place, row, sees, step, toAssigned, trail, type Actors } from "./flow";

const CHAIN = ["pending_restaurant", "accepted", "ready_for_pickup", "courier_assigned", "picked_up", "en_route", "delivered"];

/** The audit trail must hold every hop of the lifecycle, in order. */
function trailInOrder(S: string, orderId: string) {
  const t = trail(orderId);
  let at = -1;
  const ordered = CHAIN.every((s) => (at = t.indexOf(s, at + 1)) >= 0);
  check(S, "istoricul de stări (delivery_status_events) are toate etapele, în ordine", ordered, t.join(" → "));
}

export async function e1(A: Actors) {
  const S = "E1 · Card la livrare — client → restaurant → curier → livrat + încasat";
  const R = A.couriers.R;
  await goOnly(A, ["R"]);
  const id = await step(S, "clientul plasează comanda (Rainbow Roll + Philadelphia Roll, card la livrare)", () =>
    place(A, "E1", { paymentMethod: "card_on_delivery", items: [{ menu_item_id: itemId("Rainbow Roll"), quantity: 1 }, { menu_item_id: itemId("Philadelphia Roll"), quantity: 1 }] }),
  (i) => `comanda ${row(i).no}`);
  const r0 = row(id);
  eq(S, "starea inițială", r0.status, "pending_restaurant");
  eq(S, "subtotal recalculat de server", r0.subtotal, 460);
  eq(S, "total = subtotal + livrare", r0.total, r0.subtotal + r0.fee, ` (${r0.subtotal} + ${r0.fee} MDL livrare)`);
  const seen = [await sees(A.client, id), await sees(A.partner, id), await sees(R.s, id), await sees(A.admin, id)];
  eq(S, "vizibilitate (client, restaurant, curier, master) înainte de atribuire", seen.join("/"), "true/true/false/true");
  await toAssigned(A, S, id, R, "R");
  eq(S, "restaurantul vede ce curier a preluat comanda", await courierSeenBy(A.partner, id), R.id);
  eq(S, "clientul vede ce curier a preluat comanda", await courierSeenBy(A.client, id), R.id);
  eq(S, "curierul R vede comanda lui", await sees(R.s, id), "true");
  await deliver(S, A, id, R, "R");
  trailInOrder(S, id);
  await step(S, "clientul evaluează restaurantul (5★)", () => submitRating(A.client.db, oid(id), "restaurant", 5, "E2E: super"));
  await step(S, "clientul evaluează curierul (5★)", () => submitRating(A.client.db, oid(id), "courier", 5, "E2E: rapid"));
  eq(S, "curierul R e din nou disponibil", sql(`select status from couriers where id='${R.id}'`)[0][0], "online");
  // the same order as the three web apps render it (dev doorway sessions on the running app)
  const no = row(id).no;
  const cp = await (await webSession("client"))(`/orders/${id}`);
  check(S, "web client: /orders/<id> arată comanda livrată și totalul", cp.status === 200 && cp.html.includes(no) && /Livrat/.test(cp.html) && cp.html.includes("505"), `HTTP ${cp.status}`);
  const rp = await (await webSession("restaurant"))(`/restaurant/orders/${id}`);
  check(S, "web restaurant: pagina comenzii arată numărul comenzii", rp.status === 200 && rp.html.includes(no), `HTTP ${rp.status}`);
  const mp = await (await webSession("platform"))("/platform/orders");
  check(S, "web master: /platform/orders listează comanda", mp.status === 200 && mp.html.includes(no), `HTTP ${mp.status}`);
  fact(S, "order", id);
  memo.e1 = id;
}

export async function e2(A: Actors) {
  const S = "E2 · Numerar + bacșiș — float curier și predare numerar";
  const R = A.couriers.R;
  await goOnly(A, ["R"]);
  const b0 = balance(R);
  const l0 = ledgerSum(R);
  const id = await step(S, "clientul plasează comanda (Set Sakura 32 piese, numerar)", () =>
    place(A, "E2", { paymentMethod: "cash", items: [{ menu_item_id: itemId("Set Sakura 32 piese"), quantity: 1 }] }),
  (i) => `comanda ${row(i).no}`);
  await step(S, "clientul adaugă bacșiș 25 MDL", () => setOrderTip(A.client.db, oid(id), 25));
  const r0 = row(id);
  eq(S, "bacșișul salvat e 25 MDL", r0.tip, 25);
  eq(S, "totalul = 620 (set) + 45 (livrare) + 25 (bacșiș)", r0.total, 690);
  await toAssigned(A, S, id, R, "R");
  await deliver(S, A, id, R, "R");
  trailInOrder(S, id);
  const b1 = balance(R);
  const delta = +(b1 - b0).toFixed(2);
  eq(S, "numerarul încasat intră în float: exact totalul comenzii", delta, row(id).total, ` (float ${b0} → ${b1})`);
  fact(S, "cash_delta", delta);
  const adminView = await adminCourierCashStatus(A.admin.db, courierId(R.id));
  eq(S, "masterul vede soldul real (suma mișcărilor brute)", Number(adminView?.balance_mdl), ledgerSum(R));
  await step(S, "masterul înregistrează predarea numerarului (offload)", () => recordCashOffload(A.admin.db, courierId(R.id), delta, "E2E: predare numerar"), () => `float după: ${balance(R)} MDL`);
  eq(S, "float-ul curierului revine la valoarea de dinainte (mișcări brute)", ledgerSum(R), l0);
  fact(S, "order", id);
}

export async function e3(A: Actors) {
  const S = "E3 · Opțiuni obligatorii (modificatori) — validare, preț, livrare";
  const N = A.couriers.N;
  await goOnly(A, ["N"]);
  const b0 = balance(N);
  const l0 = ledgerSum(N);
  await mustFail(S, "California Roll fără sosul obligatoriu e refuzat, în română", () =>
    place(A, "E3-neg", { paymentMethod: "cash", items: [{ menu_item_id: itemId("California Roll"), quantity: 2 }] }), /alege o opțiune/i);
  const roll = itemId("California Roll");
  const sos = optionId("California Roll", "Sos", "Teriyaki");
  const wasabi = optionId("California Roll", "Extra", "Wasabi extra");
  const ginger = optionId("California Roll", "Extra", "Ghimbir extra");
  const soup = itemId("Supă Miso");
  const big = optionId("Supă Miso", "Mărime", "Mare");
  const id = await step(S, "clientul plasează cu opțiuni (2× California Roll + Teriyaki/Wasabi/Ghimbir, 1× Supă Miso Mare)", () =>
    place(A, "E3", { paymentMethod: "cash", items: [{ menu_item_id: roll, quantity: 2, option_ids: [sos, wasabi, ginger] }, { menu_item_id: soup, quantity: 1, option_ids: [big] }] }),
  (i) => `comanda ${row(i).no}`);
  const r0 = row(id);
  eq(S, "subtotal = (180+10+5+5)×2 + (80+25)", r0.subtotal, 505);
  eq(S, "opțiunile alese sunt salvate pe linii (snapshot)", sql(`select count(*) from order_items where order_id='${id}' and jsonb_array_length(coalesce(selected_options,'[]'::jsonb))>0`)[0][0], "2");
  await toAssigned(A, S, id, N, "N");
  await deliver(S, A, id, N, "N");
  trailInOrder(S, id);
  await step(S, "clientul evaluează curierul (4★)", () => submitRating(A.client.db, oid(id), "courier", 4, "E2E"));
  await step(S, "clientul evaluează restaurantul (5★)", () => submitRating(A.client.db, oid(id), "restaurant", 5, "E2E"));
  const delta = +(balance(N) - b0).toFixed(2);
  eq(S, "numerarul intră în float: exact totalul comenzii (505 + 45)", delta, 550);
  await step(S, "masterul înregistrează predarea numerarului", () => recordCashOffload(A.admin.db, courierId(N.id), delta, "E2E: predare numerar"));
  eq(S, "float-ul lui N revine la valoarea de dinainte (mișcări brute)", ledgerSum(N), l0);
  fact(S, "order", id);
}
