import { createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readViewerToken, signViewerToken, verifyViewerToken, VIEW_AS_TTL_SECONDS } from "@/lib/viewAs/token";
import { fromViewPath, toViewPath } from "@/lib/viewAs/paths";
import { createViewerClient, isViewerClient } from "@/lib/supabase/viewer";

// View-as token (node:crypto HS256, no jose) + the viewer client that never talks to GoTrue.
const SECRET = "test-secret-with-at-least-32-characters!!";
const TARGET = "a0000000-0000-0000-0000-000000000001";
const ADMIN = "a0000000-0000-0000-0000-000000000004";
const SESSION = "11111111-2222-4333-8444-555555555555";
const NOW = 1_790_000_000;
const mint = (now = NOW) => signViewerToken({ target: TARGET, admin: ADMIN, session: SESSION, app: "client" }, SECRET, now);

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const hs256 = (data: string, secret = SECRET) => createHmac("sha256", secret).update(data).digest("base64url");

describe("signViewerToken / verifyViewerToken", () => {
  it("round-trips the claims PostgREST and RLS need", () => {
    const claims = verifyViewerToken(mint(), SECRET, NOW + 1);
    expect(claims).toMatchObject({
      sub: TARGET,
      role: "viewer",
      aud: "authenticated",
      view_as_session: SESSION,
      session_id: SESSION, // never an auth.sessions row → GoTrue refuses the token
      view_as_app: "client",
      act: { sub: ADMIN },
      iat: NOW,
      exp: NOW + VIEW_AS_TTL_SECONDS,
    });
  });

  it("is a plain HS256 JWT any verifier with the project secret accepts", () => {
    const [h, p, s] = mint().split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "HS256", typ: "JWT" });
    expect(s).toBe(hs256(`${h}.${p}`));
  });

  it("rejects expired, tampered, foreign-secret and alg:none tokens", () => {
    const token = mint();
    const [h, p, s] = token.split(".");
    expect(verifyViewerToken(token, SECRET, NOW + VIEW_AS_TTL_SECONDS)).toBeNull(); // exp reached
    expect(verifyViewerToken(token, "another-secret-with-32-characters-min!!", NOW)).toBeNull();

    const other = { ...JSON.parse(Buffer.from(p, "base64url").toString()), sub: "a0000000-0000-0000-0000-000000000009" };
    expect(verifyViewerToken(`${h}.${b64(other)}.${s}`, SECRET, NOW)).toBeNull(); // payload swapped
    const flipped = s.slice(0, 5) + (s[5] === "A" ? "B" : "A") + s.slice(6);
    expect(verifyViewerToken(`${h}.${p}.${flipped}`, SECRET, NOW)).toBeNull(); // signature edited

    const none = b64({ alg: "none", typ: "JWT" });
    expect(verifyViewerToken(`${none}.${p}.`, SECRET, NOW)).toBeNull();
    expect(verifyViewerToken("not.a.jwt", SECRET, NOW)).toBeNull();
    expect(verifyViewerToken("", SECRET, NOW)).toBeNull();
  });

  it("a correctly signed token that is not a view token is still refused", () => {
    const header = b64({ alg: "HS256", typ: "JWT" });
    const sign = (claims: object) => {
      const body = `${header}.${b64(claims)}`;
      return `${body}.${hs256(body)}`;
    };
    const good = JSON.parse(Buffer.from(mint().split(".")[1], "base64url").toString());
    expect(verifyViewerToken(sign({ ...good, role: "authenticated" }), SECRET, NOW)).toBeNull(); // a normal session token
    expect(verifyViewerToken(sign({ ...good, session_id: undefined }), SECRET, NOW)).toBeNull(); // GoTrue would accept it
    expect(verifyViewerToken(sign({ ...good, exp: NOW + 24 * 3600 }), SECRET, NOW)).toBeNull(); // longer than 15 min
    expect(verifyViewerToken(sign({ ...good, view_as_app: "master" }), SECRET, NOW)).toBeNull();
    expect(verifyViewerToken(sign(good), SECRET, NOW)).not.toBeNull(); // control
  });

  it("readViewerToken: no secret configured → view-as does not exist", () => {
    vi.stubEnv("SUPABASE_JWT_SECRET", "");
    expect(readViewerToken(mint(Math.floor(Date.now() / 1000)))).toBeNull();
    vi.stubEnv("SUPABASE_JWT_SECRET", SECRET);
    expect(readViewerToken(mint(Math.floor(Date.now() / 1000)))).not.toBeNull();
    vi.unstubAllEnvs();
  });
});

describe("view paths — /view + the monolith path, only the viewed surface's pages", () => {
  it("maps in and out", () => {
    expect(toViewPath("client", "/orders/abc")).toBe("/view/orders/abc");
    expect(toViewPath("client", "/")).toBe("/view/orders");
    expect(toViewPath("client", "/checkout")).toBeNull(); // write flow
    expect(toViewPath("client", "/deliveries")).toBeNull(); // another role's surface
    expect(toViewPath("curier", "/deliveries/history")).toBe("/view/deliveries/history");
    expect(toViewPath("restaurant", "/restaurant/menu")).toBe("/view/restaurant/menu");
    expect(toViewPath("restaurant", "/restaurants")).toBeNull(); // segment-bounded
    expect(fromViewPath("client", "/view/restaurants/sakura")).toBe("/restaurants/sakura");
    expect(fromViewPath("client", "/view/restaurant/orders")).toBeNull();
    expect(fromViewPath("curier", "/viewer")).toBeNull();
  });
});

describe("createViewerClient — reads as the target, never reaches GoTrue", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("answers getUser locally, refuses auth writes locally, sends REST with the viewer token", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:59999");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "anon-key");
    vi.stubGlobal("WebSocket", class {}); // Node 20 has none; realtime-js only checks it exists here
    const seen: { url: string; auth: string | null }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
        seen.push({ url, auth: new Headers(init?.headers).get("authorization") });
        return Response.json([]);
      }),
    );
    const token = mint(Math.floor(Date.now() / 1000));
    const supabase = createViewerClient(token);
    expect(isViewerClient(supabase)).toBe(true);

    const { data } = await supabase.auth.getUser();
    expect(data.user?.id).toBe(TARGET);

    const { error } = await supabase.auth.updateUser({ password: "parola-noua" });
    expect(error?.status).toBe(403);

    await supabase.from("orders").select("id");
    expect(seen.some((r) => r.url.includes("/auth/v1/"))).toBe(false);
    const rest = seen.find((r) => r.url.includes("/rest/v1/orders"));
    expect(rest?.auth).toBe(`Bearer ${token}`);
  });
});
