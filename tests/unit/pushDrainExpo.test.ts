import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The drain route fans each outbox row out to Web Push AND to the user's Expo
// tokens (native apps). fetch is mocked; the admin client is a recorder.

type Call = { table: string; op: string; args: unknown[] };
const calls: Call[] = [];
let tokensByUser: Record<string, string[]> = {};

function fakeAdmin() {
  return {
    from(table: string) {
      return {
        select: (...a: unknown[]) => ({
          eq: async (_col: string, userId: string) => {
            calls.push({ table, op: "select", args: [...a, userId] });
            return { data: (tokensByUser[userId] ?? []).map((t) => ({ expo_token: t })), error: null };
          },
        }),
        delete: () => ({
          in: async (col: string, values: string[]) => {
            calls.push({ table, op: "delete", args: [col, values] });
            return { error: null };
          },
        }),
        update: (patch: unknown) => ({
          eq: async (_col: string, id: string) => {
            calls.push({ table, op: "update", args: [patch, id] });
            return { error: null };
          },
        }),
      };
    },
  };
}

const claimed = vi.fn();
vi.mock("@chisinau/shared-api", () => ({ claimNotificationOutbox: (...a: unknown[]) => claimed(...a) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => fakeAdmin() }));
const webPush = vi.fn(async () => {});
vi.mock("@/lib/push/send", () => ({ sendPushToUser: (...a: unknown[]) => webPush(...(a as [])) }));

const { POST } = await import("@/app/api/push/drain/route");
const { EXPO_PUSH_URL } = await import("@/lib/push/expo");

function drainRequest() {
  return new Request("http://localhost/api/push/drain", { method: "POST", headers: { "x-drain-secret": "s3cret" } });
}

const OFFER_ROW = {
  id: "row-1",
  user_id: "courier-user",
  title: "Comandă de livrat 🛵",
  body: "Sushi · #123",
  url: "/deliveries",
  tag: "offer:order-1",
  attempts: 0,
};

beforeEach(() => {
  calls.length = 0;
  webPush.mockClear();
  claimed.mockReset();
  process.env.PUSH_DRAIN_SECRET = "s3cret";
  tokensByUser = { "courier-user": ["ExponentPushToken[live]", "ExponentPushToken[dead]"] };
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("push drain → Expo fan-out", () => {
  it("sends the outbox row to every Expo token of the user, high priority for offers, and prunes DeviceNotRegistered", async () => {
    claimed.mockResolvedValue([OFFER_ROW]);
    // One request per token (a user may hold tokens of two Expo projects).
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const [m] = JSON.parse(String(init.body)) as { to: string }[];
      const ticket =
        m.to === "ExponentPushToken[dead]"
          ? { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } }
          : { status: "ok", id: "t1" };
      return new Response(JSON.stringify({ data: [ticket] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(drainRequest());
    expect(await res.json()).toEqual({ drained: 1, failed: 0 });

    expect(webPush).toHaveBeenCalledTimes(1); // web push still goes out
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toBe(EXPO_PUSH_URL);
    const messages = fetchMock.mock.calls.flatMap((c) => JSON.parse(String(c[1].body)));
    expect(messages.map((m: { to: string }) => m.to)).toEqual(["ExponentPushToken[live]", "ExponentPushToken[dead]"]);
    expect(messages[0]).toMatchObject({
      title: OFFER_ROW.title,
      body: OFFER_ROW.body,
      priority: "high",
      ttl: 40,
      channelId: "offers",
      data: { url: "/deliveries", tag: "offer:order-1" },
    });

    expect(calls).toContainEqual({ table: "device_push_tokens", op: "delete", args: ["expo_token", ["ExponentPushToken[dead]"]] });
    const outboxUpdate = calls.find((c) => c.table === "notification_outbox" && c.op === "update");
    expect(outboxUpdate?.args[0]).toMatchObject({ attempts: 1 });
    expect((outboxUpdate?.args[0] as { sent_at?: string }).sent_at).toBeTruthy();
  });

  it("a user with no Expo token costs no Expo call and still drains", async () => {
    claimed.mockResolvedValue([{ ...OFFER_ROW, user_id: "web-only-user" }]);
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await POST(drainRequest());
    expect(await res.json()).toEqual({ drained: 1, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("an Expo transport failure leaves the row for retry (attempts bumped, claim released, no sent_at)", async () => {
    claimed.mockResolvedValue([OFFER_ROW]);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("upstream down", { status: 503 })));

    const res = await POST(drainRequest());
    expect(await res.json()).toEqual({ drained: 0, failed: 1 });
    const outboxUpdate = calls.find((c) => c.table === "notification_outbox" && c.op === "update");
    expect(outboxUpdate?.args[0]).toEqual({ attempts: 1, claimed_at: null });
    expect(calls.some((c) => c.op === "delete")).toBe(false);
    expect(webPush).toHaveBeenCalledTimes(1); // an Expo outage never costs the web push
  });

  it("the retry after an Expo failure does not send the web push a second time", async () => {
    // The real claim returns the row with attempts bumped by the failed run.
    claimed.mockResolvedValueOnce([OFFER_ROW]).mockResolvedValueOnce([{ ...OFFER_ROW, attempts: 1 }]);
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("down", { status: 503 }))
        .mockImplementation(async () => new Response(JSON.stringify({ data: [{ status: "ok", id: "a" }] }))),
    );
    tokensByUser = { "courier-user": ["ExponentPushToken[live]"] };

    expect(await (await POST(drainRequest())).json()).toEqual({ drained: 0, failed: 1 });
    expect(await (await POST(drainRequest())).json()).toEqual({ drained: 1, failed: 0 });
    expect(webPush).toHaveBeenCalledTimes(1);
  });

  it("never mixes tokens in one Expo request (courier + client app = two Expo projects → 400)", async () => {
    claimed.mockResolvedValue([OFFER_ROW]);
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const msgs = JSON.parse(String(init.body)) as unknown[];
      if (msgs.length > 1) return new Response(JSON.stringify({ errors: [{ code: "PUSH_TOO_MANY_EXPERIENCE_IDS" }] }), { status: 400 });
      return new Response(JSON.stringify({ data: [{ status: "ok", id: "a" }] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await (await POST(drainRequest())).json()).toEqual({ drained: 1, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("customer status rows go normal priority on the default channel", async () => {
    claimed.mockResolvedValue([{ ...OFFER_ROW, tag: "order-xyz" }]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: [{ status: "ok", id: "a" }] })));
    vi.stubGlobal("fetch", fetchMock);

    await POST(drainRequest());
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))[0]).toMatchObject({ priority: "normal", ttl: 600, channelId: "default" });
  });
});
