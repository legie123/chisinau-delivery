import net, { type AddressInfo } from "node:net";
import { once } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { allowedTarget, start } from "../../scripts/mobile/tunnel-proxy.mjs";

// The phone tunnel must never reach Kong's /pg route (postgres-meta: anonymous SQL as postgres).
// The first version checked the RAW url, so "/rest/v1/../../pg/query" passed the allowlist and
// Kong resolved it to /pg/query — proven live on 2026-10-04 ({"current_user":"postgres"}).
describe("tunnel-proxy allowedTarget", () => {
  it("blocks /pg and every traversal / encoding trick that resolves to it", () => {
    for (const u of [
      "/pg/query",
      "/rest/v1/../../pg/query",
      "/rest/v1/%2e%2e/%2e%2e/pg/query",
      "/rest/v1/%2E%2E/%2E%2E/pg/query",
      "/rest/v1/..%2f..%2fpg/query",
      "/rest/v1%2f..%2f..%2fpg/query",
      "/rest/v1/..\\..\\pg/query",
      "//127.0.0.1:54421/pg/query",
      "/rest/v1/./../../pg/query",
      "/auth/v1/../../pg/query?x=1",
      "/pg/query?/rest/v1/",
      "/project/default",
      "/rest/v2/orders",
      "/restx/v1/orders",
      "rest/v1/orders",
    ]) {
      expect(allowedTarget(u), u).toBeNull();
    }
  });

  it("lets the supabase-js data plane through, normalized", () => {
    expect(allowedTarget("/rest/v1/orders?select=id")).toBe("/rest/v1/orders?select=id");
    expect(allowedTarget("/auth/v1/token?grant_type=password")).toBe("/auth/v1/token?grant_type=password");
    expect(allowedTarget("/realtime/v1/websocket?vsn=1.0.0")).toBe("/realtime/v1/websocket?vsn=1.0.0");
    expect(allowedTarget("/storage/v1/object/public/restaurant-photos/a.jpg")).toBe(
      "/storage/v1/object/public/restaurant-photos/a.jpg",
    );
    expect(allowedTarget("/rest/v1")).toBe("/rest/v1");
    // a harmless dot segment stays inside the data plane after normalization
    expect(allowedTarget("/rest/v1/./orders")).toBe("/rest/v1/orders");
  });
});

// The upgrade path used to splice the client socket to Kong as soon as it connected, while the
// connection was still HTTP: a request pipelined behind an allowed upgrade (POST /pg/query) went
// straight to Kong — anonymous SQL as postgres through the tunnel (verifier, 2026-10-04).
// The real proxy runs here in front of a fake Kong that answers PWNED to any /pg request.
describe("tunnel-proxy websocket upgrades", () => {
  const seen: string[] = [];
  let kong: net.Server;
  let proxy: ReturnType<typeof start>;
  let port = 0;

  beforeAll(async () => {
    kong = net.createServer((s) => {
      let upgraded = false;
      s.on("data", (d) => {
        const text = d.toString("latin1");
        if (upgraded) return void s.write("ECHO:" + text);
        for (const [, path] of text.matchAll(/^[A-Z]+ (\S+) HTTP\/1\.[01]\r$/gm)) {
          seen.push(path);
          if (path.includes("/pg/")) s.write("HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nPWNED");
          else if (path.startsWith("/realtime/v1/deny")) s.write("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: keep-alive\r\n\r\n");
          else if (path.startsWith("/realtime/v1/noreason")) {
            s.write("HTTP/1.1 101\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n"); // reason phrase is optional
            upgraded = true;
            return;
          }
          else if (path.startsWith("/realtime/v1/websocket")) {
            s.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
            upgraded = true;
            return;
          } else s.write("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: keep-alive\r\n\r\nok");
        }
      });
    });
    await once(kong.listen(0, "127.0.0.1"), "listening");
    proxy = start(0, (kong.address() as AddressInfo).port);
    await once(proxy, "listening");
    port = (proxy.address() as AddressInfo).port;
  });

  afterAll(() => {
    proxy.close();
    kong.close();
  });

  // Raw socket (curl would normalize); returns everything received within `ms`.
  async function raw(first: string, later?: string, ms = 400): Promise<string> {
    const s = net.connect(port, "127.0.0.1");
    let got = "";
    s.on("data", (d) => (got += d.toString("latin1")));
    s.on("error", () => undefined);
    await once(s, "connect");
    s.write(first);
    if (later) setTimeout(() => s.writable && s.write(later), 150);
    await new Promise((r) => setTimeout(r, ms));
    s.destroy();
    return got;
  }

  const upgrade = (path: string) => `GET ${path} HTTP/1.1\r\nHost: x\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n`;
  const sql = 'POST /pg/query HTTP/1.1\r\nHost: x\r\nContent-Type: application/json\r\nContent-Length: 2\r\n\r\n{}';

  it("a request pipelined behind an allowed upgrade never reaches Kong", async () => {
    seen.length = 0;
    const out = await raw(upgrade("/rest/v1/") + sql);
    expect(out).not.toContain("PWNED");
    expect(seen.filter((p) => p.includes("/pg/"))).toEqual([]);
  });

  it("an upgrade Kong refuses is answered once and closed (no keep-alive pipe)", async () => {
    seen.length = 0;
    const out = await raw(upgrade("/realtime/v1/deny"), sql);
    expect(out).toMatch(/^HTTP\/1\.1 403/);
    expect(out).not.toContain("PWNED");
    expect(seen).toEqual(["/realtime/v1/deny"]);
  });

  it("only realtime may upgrade, and only without bytes before the handshake", async () => {
    seen.length = 0;
    expect(await raw(upgrade("/rest/v1/"))).toMatch(/^HTTP\/1\.1 404/);
    expect(await raw(upgrade("/realtime/v1/websocket") + sql)).toMatch(/^HTTP\/1\.1 404/);
    expect(seen).toEqual([]);
  });

  it("a 101 without a reason phrase is still an upgrade", async () => {
    const out = await raw(upgrade("/realtime/v1/noreason"), "hi");
    expect(out).toMatch(/^HTTP\/1\.1 101\r\n/);
    expect(out).toContain("ECHO:hi");
  });

  it("the realtime websocket still works end to end", async () => {
    const out = await raw(upgrade("/realtime/v1/websocket?vsn=1.0.0"), "hello");
    expect(out).toMatch(/^HTTP\/1\.1 101/);
    expect(out).toContain("ECHO:hello");
  });
});
