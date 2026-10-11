// Kitchen tablet, network cut during an order (gate G2). Not part of `npm test`:
// it drives :3003 in a real Chromium and COMMITS one test order (notes KITCHEN-NET-*),
// which it then accepts through the UI.
// Run: PW=<path to playwright pkg> EXE=<chromium binary> Q=<psql helper> node tests/kitchen/network-cut.cjs
// Asserts: (1) while offline the order does NOT reach the page (the cut is real);
// (2) after reconnect it appears AND the alarm beeps within 20 s; (3) a stray tap does
// not silence it — it keeps beeping until Accept; (4) the connection pill returns to Live.
const { chromium } = require(process.env.PW);
const { execFileSync } = require("child_process");
const BASE = process.env.BASE ?? "http://localhost:3003";
const sql = (q) => execFileSync(process.env.Q, [q]).toString().trim();
const tag = `KITCHEN-NET-${Date.now()}`;
const fail = (m) => { console.error("FAIL:", m); process.exitCode = 1; };

const asPartner = (q) =>
  sql(`begin; select set_config('request.jwt.claims', '{"sub":"a0000000-0000-0000-0000-000000000003","role":"authenticated"}', true); set local role authenticated; ${q}; commit;`);

(async () => {
  // Leftovers of an earlier failed run would ring from the first second: reject them via the RPC.
  asPartner(`select public.reject_order(id, 'test bucătărie (RESTAURANT)') from public.orders where notes like 'KITCHEN-NET-%' and status = 'pending_restaurant'`);
  const b = await chromium.launch({ executablePath: process.env.EXE });
  const ctx = await b.newContext({ viewport: { width: 1024, height: 768 } });
  await ctx.addInitScript(() => {
    window.__beeps = 0;
    const start = OscillatorNode.prototype.start;
    OscillatorNode.prototype.start = function (...a) { window.__beeps++; return start.apply(this, a); };
  });
  // A real cut closes the realtime socket and refuses new ones (Chromium's setOffline alone
  // only stalls an open WebSocket — measured: the pill stayed "Live" for 45 s and the
  // INSERT arrived 0.3 s after "reconnect", which is not what a dropped Wi-Fi does).
  let cut = false;
  const sockets = [];
  await ctx.routeWebSocket(/\/realtime\//, (ws) => {
    if (cut) return ws.close({ code: 4000, reason: "network cut" });
    ws.connectToServer();
    sockets.push(ws);
  });
  await ctx.request.post(`${BASE}/enter/restaurant`, { maxRedirects: 0 });
  const p = await ctx.newPage();
  const navs = [];
  p.on("framenavigated", (f) => { if (f === p.mainFrame()) navs.push(`${new Date().toISOString().slice(11, 19)} ${f.url()}`); });
  await p.goto(`${BASE}/restaurant/orders`, { waitUntil: "networkidle" });
  // The one tap the kitchen does: the unlock button, or the full-screen prompt if something is already ringing.
  await p.getByRole("button", { name: /Activează sunetul|Atinge ecranul/ }).first().click();
  await p.getByText("Live", { exact: true }).waitFor({ timeout: 15000 });
  const beeps = () => p.evaluate(() => window.__beeps);

  const mark = await p.evaluate(() => (window.__alive = Math.random()));
  cut = true;
  for (const ws of sockets.splice(0)) await ws.close({ code: 4000, reason: "network cut" }).catch(() => {});
  await ctx.setOffline(true);
  await p.waitForTimeout(3000);
  const number = sql(`insert into public.orders (order_type, customer_id, restaurant_id, status, payment_method, payment_status, subtotal_mdl, delivery_fee_mdl, total_mdl, notes) values ('standard','a0000000-0000-0000-0000-000000000001','11111111-1111-1111-1111-111111111111','pending_restaurant','cash','unpaid',200,30,230,'${tag}') returning order_number`).split("\n")[0];
  const offBeeps0 = await beeps();
  await p.waitForTimeout(Number(process.env.OFFLINE_MS ?? 45000)); // a real Wi-Fi drop, longer than the realtime heartbeat
  const pillOffline = (await p.locator("main h1").locator("..").innerText()).replace(/\n/g, " ");
  console.log(`while offline: beeps +${(await beeps()) - offBeeps0}, header: ${pillOffline}`);
  if ((await beeps()) - offBeeps0 > 0) fail("beeped while offline — the realtime socket was not actually cut");
  if (await p.getByText(number).count()) fail("order reached the page while offline — the cut is not real");
  const before = await beeps();

  cut = false;
  await ctx.setOffline(false);
  const t0 = Date.now();
  try {
    await p.getByText(number).first().waitFor({ timeout: 20000 });
    console.log(`order visible ${((Date.now() - t0) / 1000).toFixed(1)} s after reconnect`);
  } catch { fail("order not visible 20 s after reconnect"); }
  await p.waitForTimeout(3000);
  const afterReconnect = await beeps();
  console.log(`beeps after reconnect: ${afterReconnect - before}`);
  if (afterReconnect - before < 1) fail("no alarm after reconnect — the order arrived silently");

  await p.locator("h1").click(); // a stray tap, not an action on the order
  await p.waitForTimeout(6000);
  const afterTap = await beeps();
  console.log(`beeps in 6 s after a stray tap: ${afterTap - afterReconnect}`);
  if (afterTap - afterReconnect < 2) fail("a stray tap silenced the alarm while the order is still pending");

  const row = p.locator("li", { hasText: number });
  if (await row.count()) await row.getByRole("button", { name: "Acceptă" }).click();
  await p.waitForTimeout(4000);
  const afterAccept = await beeps();
  await p.waitForTimeout(5000);
  const quiet = (await beeps()) - afterAccept;
  console.log(`beeps in 5 s after Accept: ${quiet}`);
  if (quiet > 0 && sql(`select count(*) from orders where restaurant_id='11111111-1111-1111-1111-111111111111' and status='pending_restaurant'`) === "0")
    fail("still beeping after the last pending order was accepted");
  try { await p.getByText("Live", { exact: true }).waitFor({ timeout: 30000 }); console.log("pill back to Live"); }
  catch { fail("connection pill never returned to Live"); }
  console.log(sql(`select status from orders where notes='${tag}'`) === "accepted" ? "order accepted" : "order NOT accepted");
  const survived = await p.evaluate((m) => window.__alive === m, mark);
  console.log(`same page survived the cut (no reload, sound context kept): ${survived}`);
  if (!survived) fail("the queue page was reloaded during/after the cut — its unlocked sound is lost");
  console.log("main-frame navigations (incl. same-document):", navs.slice(1));
  await p.screenshot({ path: (process.env.SHOT_DIR ?? "/tmp") + "/kitchen-net-end.png" });
  await b.close();
  console.log(process.exitCode ? "RESULT: FAIL" : "RESULT: PASS");
})().catch((e) => { console.error("ERROR", e.message); process.exit(1); });
