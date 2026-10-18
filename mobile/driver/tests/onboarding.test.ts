import { describe, expect, it, vi } from "vitest";
import {
  DEFAULT_CITY,
  STAGE_TEXT,
  VEHICLE_TYPES,
  captureIdPhoto,
  fetchMyApplication,
  kycPath,
  normalizePhone,
  rootScreen,
  sessionKind,
  signInOrSignUp,
  stageOf,
  submitApplication,
  toApplicationInput,
  validateForm,
  type ApplicationForm,
} from "../src/lib/onboarding";

const valid: ApplicationForm = {
  fullName: "  Ion Creangă ",
  phone: "069 123 456",
  city: DEFAULT_CITY,
  vehicleType: "e_bike",
  photoUri: "file:///tmp/buletin.jpg",
};

describe("validateForm — every field the reviewer needs, Romanian messages", () => {
  it("accepts the filled form", () => {
    expect(validateForm(valid)).toEqual({});
  });
  it("refuses an empty form naming every missing field", () => {
    const errors = validateForm({ fullName: "", phone: "", city: "", vehicleType: "bike", photoUri: null });
    expect(errors).toEqual({
      fullName: "Scrie numele complet.",
      phone: "Scrie numărul de telefon.",
      city: "Alege orașul.",
      photoUri: "Fă o poză la buletin.",
    });
  });
  it("wants a surname too, not a lone first name", () => {
    expect(validateForm({ ...valid, fullName: "Ion" }).fullName).toBeTruthy();
  });
  it("refuses a non-Moldovan phone", () => {
    expect(validateForm({ ...valid, phone: "+40 721 000 000" }).phone).toBeTruthy();
    expect(validateForm({ ...valid, phone: "12345" }).phone).toBeTruthy();
  });
  it("refuses a vehicle outside the couriers.vehicle_type CHECK", () => {
    expect(validateForm({ ...valid, vehicleType: "motorbike" as never }).vehicleType).toBeTruthy();
  });
});

describe("normalizePhone — stored as +373XXXXXXXX whatever the courier typed", () => {
  it.each([
    ["069123456", "+37369123456"],
    ["069 123 456", "+37369123456"],
    ["+373 69 123 456", "+37369123456"],
    ["373-69-123-456", "+37369123456"],
    ["0037369123456", "+37369123456"],
  ])("%s -> %s", (raw, want) => {
    expect(normalizePhone(raw)).toBe(want);
  });
  it.each(["69123456", "+37369", "+40721000000", "abc"])("%s is not a Moldovan number", (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });
});

describe("toApplicationInput — the submit_onboarding_application contract", () => {
  it("maps to type=courier with trimmed name, normalized phone and details the reviewer provisions from", () => {
    expect(toApplicationInput(valid, "ion@test.md")).toEqual({
      type: "courier",
      fullName: "Ion Creangă",
      phone: "+37369123456",
      email: "ion@test.md",
      details: { vehicle_type: "e_bike", city: "Chișinău" },
    });
  });
  it("offers exactly the CHECK values the approval copies into couriers.vehicle_type", () => {
    expect([...VEHICLE_TYPES]).toEqual(["bike", "e_bike", "scooter", "car"]);
  });
});

describe("kycPath — storage policy kyc_upload_own keys on the FIRST segment = auth.uid()", () => {
  it("puts the photo under the user's folder, one level, as .jpg", () => {
    const p = kycPath("user-1", "app-1", 1760000000000, "a/b!c");
    expect(p).toBe("user-1/app-1-id_card-1760000000000-abc.jpg");
    expect(p.split("/")).toHaveLength(2);
  });
});

// ---- the flows, with the Supabase client faked at the call boundary ----

type Call = [string, unknown];
function fakeDb(opts: {
  userId?: string | null;
  rpc?: (name: string, args: unknown) => { data: unknown; error: null | { message: string; code?: string } };
  upload?: () => { error: null | { message: string; statusCode?: string } };
  courierRow?: { data: unknown; error: unknown };
  application?: { data: unknown; error: unknown };
}) {
  const calls: Call[] = [];
  const session = opts.userId ? { user: { id: opts.userId, email: "ion@test.md" } } : null;
  const db = {
    auth: { getSession: async () => ({ data: { session }, error: null }) },
    rpc: async (name: string, args: unknown) => {
      calls.push([name, args]);
      return opts.rpc ? opts.rpc(name, args) : { data: null, error: null };
    },
    storage: {
      from: (bucket: string) => ({
        upload: async (path: string, body: ArrayBuffer, options: unknown) => {
          calls.push(["upload", { bucket, path, bytes: body.byteLength, options }]);
          return opts.upload ? opts.upload() : { error: null };
        },
      }),
    },
    from: (table: string) => {
      const q = {
        select: () => q,
        eq: () => q,
        order: () => q,
        limit: () => q,
        maybeSingle: async () => {
          calls.push(["select", table]);
          if (table === "couriers") return opts.courierRow ?? { data: null, error: null };
          return opts.application ?? { data: null, error: null };
        },
      };
      return q;
    },
  };
  return { db: db as never, calls };
}

const readFile = async () => new ArrayBuffer(3);

describe("submitApplication — RPC, then upload under the uid, then add_kyc_document with that same path", () => {
  it("happy path: the three calls in order, the document attached to the returned application id", async () => {
    const { db, calls } = fakeDb({
      userId: "user-1",
      rpc: (name) => ({ data: name === "submit_onboarding_application" ? "app-1" : null, error: null }),
    });
    const out = await submitApplication(db, valid, { readFile, now: () => 1, rand: () => "r" });
    expect(out).toEqual({ ok: true, applicationId: "app-1", docError: null });
    expect(calls.map((c) => c[0])).toEqual(["submit_onboarding_application", "upload", "add_kyc_document"]);
    expect(calls[0][1]).toEqual({
      p_type: "courier",
      p_full_name: "Ion Creangă",
      p_phone: "+37369123456",
      p_email: "ion@test.md",
      p_details: { vehicle_type: "e_bike", city: "Chișinău" },
    });
    const upload = calls[1][1] as { bucket: string; path: string; bytes: number; options: { contentType: string } };
    expect(upload.bucket).toBe("kyc-documents");
    expect(upload.path).toBe("user-1/app-1-id_card-1-r.jpg");
    expect(upload.bytes).toBe(3);
    expect(upload.options.contentType).toBe("image/jpeg");
    expect(calls[2][1]).toEqual({ p_application_id: "app-1", p_doc_type: "id_card", p_storage_path: upload.path });
  });

  it("a second pending application is refused with the RPC's own Romanian text", async () => {
    const { db, calls } = fakeDb({
      userId: "user-1",
      rpc: () => ({ data: null, error: { message: "ai deja o cerere în așteptare", code: "P0001" } }),
    });
    const out = await submitApplication(db, valid, { readFile, now: () => 1, rand: () => "r" });
    expect(out).toEqual({ ok: false, error: "Ai deja o cerere în așteptare." });
    expect(calls.map((c) => c[0])).toEqual(["submit_onboarding_application"]);
  });

  it("an upload refused by storage leaves the application in place and says so (no add_kyc_document)", async () => {
    const { db, calls } = fakeDb({
      userId: "user-1",
      rpc: () => ({ data: "app-1", error: null }),
      upload: () => ({ error: { message: "new row violates row-level security policy", statusCode: "403" } }),
    });
    const out = await submitApplication(db, valid, { readFile, now: () => 1, rand: () => "r" });
    expect(out).toEqual({ ok: true, applicationId: "app-1", docError: "Nu ai permisiunea să încarci acest fișier." });
    expect(calls.map((c) => c[0])).toEqual(["submit_onboarding_application", "upload"]);
  });

  it("without a session nothing is sent", async () => {
    const { db, calls } = fakeDb({ userId: null });
    const out = await submitApplication(db, valid, { readFile, now: () => 1, rand: () => "r" });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/sesiun/i);
    expect(calls).toEqual([]);
  });
});

describe("sessionKind — who is holding the phone", () => {
  it("no session -> none", async () => {
    expect(await sessionKind(fakeDb({ userId: null }).db)).toBe("none");
  });
  it("a couriers row -> courier", async () => {
    expect(await sessionKind(fakeDb({ userId: "u", courierRow: { data: { id: "c" }, error: null } }).db)).toBe("courier");
  });
  it("signed in, no couriers row -> applicant (and is NOT signed out)", async () => {
    const { db, calls } = fakeDb({ userId: "u", courierRow: { data: null, error: null } });
    expect(await sessionKind(db)).toBe("applicant");
    expect(calls.some((c) => c[0] === "signOut")).toBe(false);
  });
  it("a failed read -> unknown (never 'applicant' on a dead zone)", async () => {
    expect(await sessionKind(fakeDb({ userId: "u", courierRow: { data: null, error: { message: "network" } } }).db)).toBe("unknown");
  });
});

describe("fetchMyApplication — the 'în verificare' screen reads the applicant's own row (RLS onboarding_self_read)", () => {
  it("maps status, note and the attached document count", async () => {
    const { db } = fakeDb({
      userId: "u",
      application: { data: { id: "app-1", status: "rejected", review_note: "poza ilizibilă", created_at: "2026-10-13", kyc_documents: [{ id: "d1" }] }, error: null },
    });
    expect(await fetchMyApplication(db)).toEqual({ id: "app-1", status: "rejected", reviewNote: "poza ilizibilă", docs: 1, createdAt: "2026-10-13" });
  });
  it("no application yet -> null; a failed read throws (the screen shows a retry, not the empty form)", async () => {
    expect(await fetchMyApplication(fakeDb({ userId: "u" }).db)).toBeNull();
    await expect(fetchMyApplication(fakeDb({ userId: "u", application: { data: null, error: { message: "boom" } } }).db)).rejects.toThrow();
  });
});

describe("signInOrSignUp — the account step for a courier who has no account yet", () => {
  const pw = "parola123";
  function authDb(signIn: { error: null | { message: string; code?: string } }, signUp: { data: { session: unknown }; error: null | { message: string; code?: string } }) {
    const fnIn = vi.fn(async () => signIn);
    const fnUp = vi.fn(async () => signUp);
    return { db: { auth: { signInWithPassword: fnIn, signUp: fnUp } } as never, signInWithPassword: fnIn, signUp: fnUp };
  }
  it("validates locally first: email shape and 6+ character password", async () => {
    const { db, signInWithPassword } = authDb({ error: null }, { data: { session: null }, error: null });
    expect(await signInOrSignUp(db, "ion", "parola123")).toMatch(/email/i);
    expect(await signInOrSignUp(db, "ion@test.md", "123")).toMatch(/6/);
    expect(signInWithPassword).not.toHaveBeenCalled();
  });
  it("existing account + right password -> in, no sign-up attempted", async () => {
    const { db, signUp } = authDb({ error: null }, { data: { session: null }, error: null });
    expect(await signInOrSignUp(db, " Ion@Test.md ", "parola123")).toBeNull();
    expect(signUp).not.toHaveBeenCalled();
  });
  it("unknown email -> account created and signed in", async () => {
    const { db, signUp } = authDb({ error: { message: "Invalid login credentials", code: "invalid_credentials" } }, { data: { session: {} }, error: null });
    expect(await signInOrSignUp(db, "nou@test.md", "parola123")).toBeNull();
    expect(signUp.mock.calls[0][0]).toEqual({ email: "nou@test.md", password: pw });
  });
  it("existing email + wrong password -> told the password is wrong, not 'user already registered'", async () => {
    const { db } = authDb({ error: { message: "Invalid login credentials" } }, { data: { session: null }, error: { message: "User already registered", code: "user_already_exists" } });
    const msg = await signInOrSignUp(db, "ion@test.md", "gresita");
    expect(msg).toMatch(/parol/i);
    expect(msg).not.toMatch(/registered/);
  });
  it("sign-up that needs email confirmation says so instead of showing an empty form", async () => {
    const { db } = authDb({ error: { message: "Invalid login credentials" } }, { data: { session: null }, error: null });
    expect(await signInOrSignUp(db, "nou@test.md", "parola123")).toMatch(/confirm/i);
  });
});

describe("captureIdPhoto — camera only, like the delivery proof", () => {
  it("no permission -> told in Romanian, no camera", async () => {
    const alert = vi.fn();
    const launchCamera = vi.fn();
    expect(await captureIdPhoto({ requestCamera: async () => ({ granted: false }), launchCamera, alert })).toBeNull();
    expect(alert).toHaveBeenCalled();
    expect(alert.mock.calls[0][1]).toMatch(/camer/i);
    expect(launchCamera).not.toHaveBeenCalled();
  });
  it("cancelled -> null; taken -> the asset uri", async () => {
    const requestCamera = async () => ({ granted: true });
    const alert = vi.fn();
    expect(await captureIdPhoto({ requestCamera, launchCamera: async () => ({ canceled: true, assets: null }), alert })).toBeNull();
    expect(await captureIdPhoto({ requestCamera, launchCamera: async () => ({ canceled: false, assets: [{ uri: "file:///x.jpg" }] }), alert })).toBe("file:///x.jpg");
    expect(alert).not.toHaveBeenCalled();
  });
});

describe("rootScreen — App.tsx keeps an applicant signed in and on onboarding", () => {
  it("applicant -> onboarding even without tapping 'Devino curier'", () => {
    expect(rootScreen("applicant", false)).toBe("onboarding");
  });
  it("no session -> login, or onboarding once 'Devino curier' was tapped", () => {
    expect(rootScreen("none", false)).toBe("login");
    expect(rootScreen("none", true)).toBe("onboarding");
  });
  it("courier and dead-zone 'unknown' -> the app (trusted, as before)", () => {
    expect(rootScreen("courier", false)).toBe("main");
    expect(rootScreen("unknown", true)).toBe("main");
  });
});

describe("stageOf — the 'în verificare' screen follows onboarding_applications.status", () => {
  const app = { id: "a", reviewNote: null, docs: 1, createdAt: "2026-10-13" };
  it("no application -> the form; pending/approved/rejected -> that stage with Romanian copy", () => {
    expect(stageOf(null)).toBe("form");
    for (const status of ["pending", "approved", "rejected"] as const) {
      expect(stageOf({ ...app, status })).toBe(status);
      expect(STAGE_TEXT[status].title.length).toBeGreaterThan(0);
    }
    expect(STAGE_TEXT.pending.title).toBe("Cererea e în verificare");
    expect(STAGE_TEXT.approved.body).toMatch(/Intră în tură/);
  });
});
