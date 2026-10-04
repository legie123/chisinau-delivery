// Cross-app E2E: 5 scenarios + settlement through the real roles and the real shared-api wrappers.
// NOT part of `npm test` (it needs the local stack and COMMITS data — orders tagged E2E-<run>-*).
// Run: npm run test:e2e   ·   report: tests/e2e/.last-report.json
import { afterAll, describe, expect, it } from "vitest";
import { setCourierOnlineStatus } from "@chisinau/shared-api";
import { check, checks, failures, login, sql, table, writeReport } from "./harness";
import { Abort, REST_POINT, memo, type Actors, type CourierKey } from "./flow";
import { e1, e2, e3 } from "./scenarios-a";
import { e4, e5, settlement } from "./scenarios-b";

// E2E_ONLY=E1,E2 runs just those scenarios (mutation checks); default = all.
const ONLY = process.env.E2E_ONLY?.split(",").map((x) => x.trim());
const want = (id: string) => !ONLY || ONLY.includes(id);

const RUN = new Date().toISOString().slice(11, 19).replace(/:/g, "");
let A: Actors;
let startedAt = "";

async function scenario(fn: (a: Actors) => Promise<void>) {
  const before = failures().length;
  try {
    await fn(A);
  } catch (e) {
    if (!(e instanceof Abort)) check("runner", fn.name, false, e instanceof Error ? e.message : String(e));
  }
  expect(failures().slice(before).map((c) => `${c.scenario} :: ${c.step} — ${c.detail}`)).toEqual([]);
}

describe.sequential("cross-app E2E (client · restaurant · courier · master)", () => {
  it("pregătire: conturi reale, curieri liberi, stare inițială", async () => {
    const [client, partner, admin] = await Promise.all([login("client@test.md"), login("partener@test.md"), login("admin@test.md")]);
    const spots: Record<CourierKey, [string, number]> = { R: ["radu.sandu.courier@test.md", 0], N: ["nicolae.bejan.courier@test.md", 0.002], G: ["grigore.tofan.courier@test.md", 0.004] };
    const couriers = {} as Actors["couriers"];
    for (const k of Object.keys(spots) as CourierKey[]) {
      const s = await login(spots[k][0]);
      const { data } = await s.db.from("couriers").select("id").maybeSingle();
      couriers[k] = { s, id: data!.id, at: { lat: REST_POINT.lat + spots[k][1], lng: REST_POINT.lng } };
    }
    const addr = sql(`select id from addresses where customer_id='${client.userId}' and contact_phone is not null limit 1`)[0][0];
    A = { client, partner, admin, couriers, addressId: addr, run: RUN };
    startedAt = sql("select now()")[0][0];
    const busy = sql(`select count(*) from orders where courier_id in ('${couriers.R.id}','${couriers.N.id}','${couriers.G.id}') and status in ('courier_assigned','picked_up','en_route')`)[0][0];
    expect(busy).toBe("0");
    // dispatch isolation: a stray online courier with a fresh GPS point could take an E2E offer
    const strays = sql(`select u.email from couriers c join auth.users u on u.id=c.user_id where c.status='online' and u.email not in ('radu.sandu.courier@test.md','nicolae.bejan.courier@test.md','grigore.tofan.courier@test.md')`).map((r) => r[0]);
    if (strays.length > 0 && process.env.E2E_ALLOW_ONLINE !== "1") throw new Error(`alți curieri sunt ONLINE (${strays.join(", ")}): oferta de test le-ar putea ajunge lor. Pune-i offline sau rulează cu E2E_ALLOW_ONLINE=1.`);
    // a red run must not poison the next one
    const stale = sql("select count(*) from orders where notes like 'E2E-%' and status not in ('delivered','cancelled','rejected')")[0][0];
    if (stale !== "0") throw new Error(`${stale} comenzi E2E sunt rămase într-o stare deschisă dintr-o rulare anterioară: închide-le (restaurantul le poate anula) înainte de o rulare nouă.`);
    for (const k of Object.keys(couriers) as CourierKey[]) memo[`float${k}`] = String(+sql(`select public.courier_cash_balance('${couriers[k].id}')`)[0][0]);
    check("pregătire", "6 conturi reale autentificate prin GoTrue (client, restaurant, master, 3 curieri)", true, `rulare ${RUN}`);
  }, 120_000);

  it.skipIf(!want("E1"))("E1 card la livrare — flux complet", () => scenario(e1), 180_000);
  it.skipIf(!want("E2"))("E2 numerar + bacșiș + float", () => scenario(e2), 180_000);
  it.skipIf(!want("E3"))("E3 opțiuni obligatorii", () => scenario(e3), 180_000);
  it.skipIf(!want("E4"))("E4 catering ofertă întâi", () => scenario(e4), 180_000);
  it.skipIf(!want("E5"))("E5 excepții", () => scenario(e5), 300_000);
  it.skipIf(!want("S"))("S decontare", () => scenario((a) => settlement(a, startedAt)), 180_000);

  afterAll(async () => {
    if (A) for (const k of ["R", "N", "G"] as CourierKey[]) await setCourierOnlineStatus(A.couriers[k].s.db, false).catch(() => undefined);
    const file = writeReport(RUN);
    process.stdout.write(`\n${table()}\n\n${checks.filter((c) => c.ok).length}/${checks.length} verificări OK · raport: ${file}\n`);
  });
});
