import type { SupabaseClient } from "@supabase/supabase-js";
import { isAuthRetryableFetchError } from "@supabase/supabase-js";
import type { Database } from "@chisinau/shared-types";
import { RpcError, addKycDocument, storageErrorText, submitOnboardingApplication, type OnboardingInput } from "@chisinau/shared-api";
import { CAMERA_OPTIONS } from "./deliveryProof";

// Courier self-registration from the phone (ȚINTA K5, rows 66-68): the same RPCs the web's
// /devino-partener uses (submit_onboarding_application + add_kyc_document, via @chisinau/shared-api),
// the same private bucket and path shape (kyc-documents, FIRST segment = auth.uid(): policy
// kyc_upload_own), and the applicant reads his own row back (policy onboarding_self_read).
// Everything that decides something is pure or takes its effects as parameters, so vitest runs it.

type Db = SupabaseClient<Database>;

export const DEFAULT_CITY = "Chișinău";
/** couriers.vehicle_type CHECK values offered to an applicant (on_foot exists in the CHECK, not offered here). */
export const VEHICLE_TYPES = ["bike", "e_bike", "scooter", "car"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];
export const VEHICLE_LABELS: Record<VehicleType, string> = {
  bike: "Bicicletă",
  e_bike: "Bicicletă electrică",
  scooter: "Scuter",
  car: "Mașină",
};

export interface ApplicationForm {
  fullName: string;
  phone: string;
  city: string;
  vehicleType: VehicleType;
  photoUri: string | null;
}
export type FormErrors = Partial<Record<keyof ApplicationForm, string>>;

/** +373XXXXXXXX for any way a Moldovan number is typed (069…, +373 69…, 00373…); null otherwise. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  const national = digits.startsWith("00373")
    ? digits.slice(5)
    : digits.startsWith("373")
      ? digits.slice(3)
      : digits.startsWith("0")
        ? digits.slice(1)
        : null;
  return national && /^\d{8}$/.test(national) ? `+373${national}` : null;
}

export function validateForm(form: ApplicationForm): FormErrors {
  const errors: FormErrors = {};
  const name = form.fullName.trim();
  if (!name) errors.fullName = "Scrie numele complet.";
  else if (name.split(/\s+/).length < 2) errors.fullName = "Scrie și numele de familie, nu doar prenumele.";
  if (!form.phone.trim()) errors.phone = "Scrie numărul de telefon.";
  else if (!normalizePhone(form.phone)) errors.phone = "Număr invalid — scrie un număr din Moldova (ex. 069 123 456).";
  if (!form.city.trim()) errors.city = "Alege orașul.";
  if (!(VEHICLE_TYPES as readonly string[]).includes(form.vehicleType)) errors.vehicleType = "Alege tipul de vehicul.";
  if (!form.photoUri) errors.photoUri = "Fă o poză la buletin.";
  return errors;
}

/** The submit_onboarding_application contract (what review_onboarding_application copies into couriers). */
export function toApplicationInput(form: ApplicationForm, email: string): OnboardingInput {
  return {
    type: "courier",
    fullName: form.fullName.trim(),
    phone: normalizePhone(form.phone) ?? form.phone.trim(),
    email,
    details: { vehicle_type: form.vehicleType, city: form.city.trim() },
  };
}

/** Storage key: `<uid>/<application>-id_card-<ts>-<rand>.jpg` — one level, uid first (kyc_upload_own). */
export function kycPath(userId: string, applicationId: string, now: number, rand: string): string {
  return `${userId}/${applicationId}-id_card-${now}-${rand.replace(/[^a-z0-9]/gi, "")}.jpg`;
}

// RpcError texts pass Romanian `raise exception` bodies through as written in SQL
// ("ai deja o cerere în așteptare"): shown on a screen they start a sentence.
function sentence(text: string): string {
  const t = text.trim();
  return t.charAt(0).toUpperCase() + t.slice(1) + (/[.!?]$/.test(t) ? "" : ".");
}
function errorText(err: unknown): string {
  if (err instanceof RpcError) return sentence(err.userMessage);
  if (isAuthRetryableFetchError(err) || (err instanceof TypeError && /network|fetch/i.test(err.message))) {
    return "Fără conexiune — încearcă din nou când ai semnal.";
  }
  return "A apărut o eroare. Încearcă din nou.";
}

const NO_SESSION = "Sesiunea a expirat — intră din nou în cont.";

export interface SubmitDeps {
  readFile: (uri: string) => Promise<ArrayBuffer>;
  now: () => number;
  rand: () => string;
}
export type SubmitResult = { ok: true; applicationId: string; docError: string | null } | { ok: false; error: string };

/** Upload the ID photo under the uid and record it on the application. Romanian error or null. */
export async function attachIdPhoto(db: Db, userId: string, applicationId: string, uri: string, deps: SubmitDeps): Promise<string | null> {
  try {
    const path = kycPath(userId, applicationId, deps.now(), deps.rand());
    const body = await deps.readFile(uri);
    const { error } = await db.storage.from("kyc-documents").upload(path, body, { contentType: "image/jpeg" });
    if (error) return storageErrorText(error);
    await addKycDocument(db, applicationId, "id_card", path);
    return null;
  } catch (err) {
    return errorText(err);
  }
}

/** RPC first (the application exists even if the photo fails), then the photo; a failed photo is reported, not fatal. */
export async function submitApplication(db: Db, form: ApplicationForm, deps: SubmitDeps): Promise<SubmitResult> {
  const { data } = await db.auth.getSession();
  const user = data.session?.user;
  if (!user) return { ok: false, error: NO_SESSION };
  let applicationId: string;
  try {
    applicationId = await submitOnboardingApplication(db, toApplicationInput(form, user.email ?? ""));
  } catch (err) {
    return { ok: false, error: errorText(err) };
  }
  const docError = form.photoUri ? await attachIdPhoto(db, user.id, applicationId, form.photoUri, deps) : "Fă o poză la buletin.";
  return { ok: true, applicationId, docError };
}

export type SessionKind = "none" | "courier" | "applicant" | "unknown";

/** Who holds the phone: no session / a courier / signed in without a couriers row / cannot tell (dead zone). */
export async function sessionKind(db: Db): Promise<SessionKind> {
  const { data, error } = await db.auth.getSession();
  // No session + a retryable refresh failure = a stored session that lapsed in a dead zone (auth-js keeps it).
  if (!data.session) return isAuthRetryableFetchError(error) ? "unknown" : "none";
  const courier = await db.from("couriers").select("id").maybeSingle(); // couriers_self_read: own row only
  if (courier.error) return "unknown";
  return courier.data ? "courier" : "applicant";
}

export interface MyApplication {
  id: string;
  status: "pending" | "approved" | "rejected";
  reviewNote: string | null;
  docs: number;
  createdAt: string;
}

/** The applicant's latest application (onboarding_self_read + kyc_self_read); null when none, throws when unreadable. */
export async function fetchMyApplication(db: Db): Promise<MyApplication | null> {
  const { data, error } = await db
    .from("onboarding_applications")
    .select("id, status, review_note, created_at, kyc_documents(id)")
    .eq("applicant_type", "courier")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return {
    id: data.id,
    status: data.status as MyApplication["status"],
    reviewNote: data.review_note ?? null,
    docs: data.kyc_documents?.length ?? 0,
    createdAt: data.created_at,
  };
}

/** Account step: sign in, or create the account when the email is unknown. Romanian error or null once signed in. */
export async function signInOrSignUp(db: Db, rawEmail: string, pwd: string): Promise<string | null> {
  const email = rawEmail.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return "Scrie un email valid.";
  if (pwd.length < 6) return "Parola trebuie să aibă cel puțin 6 caractere.";
  const signIn = await db.auth.signInWithPassword({ email, password: pwd });
  if (!signIn.error) return null;
  if (isAuthRetryableFetchError(signIn.error)) return "Fără conexiune — încearcă din nou când ai semnal.";
  const signUp = await db.auth.signUp({ email, password: pwd });
  if (signUp.error) {
    if (signUp.error.code === "user_already_exists" || /already (been )?registered/i.test(signUp.error.message)) {
      return "Există deja un cont cu acest email, dar parola nu e corectă.";
    }
    if (isAuthRetryableFetchError(signUp.error)) return "Fără conexiune — încearcă din nou când ai semnal.";
    return "Contul nu a putut fi creat. Încearcă din nou.";
  }
  if (!signUp.data.session) return "Confirmă emailul din mesajul primit, apoi intră din nou.";
  return null;
}

/** The ID photo: camera only, like the delivery proof. null when refused or cancelled. */
export async function captureIdPhoto(deps: {
  requestCamera: () => Promise<{ granted: boolean }>;
  launchCamera: (options: typeof CAMERA_OPTIONS) => Promise<{ canceled: boolean; assets: { uri: string }[] | null }>;
  alert: (title: string, text: string) => void;
}): Promise<string | null> {
  const perm = await deps.requestCamera();
  if (!perm.granted) {
    deps.alert("Camera nu e permisă", "Permite accesul la cameră din setările telefonului ca să fotografiezi buletinul.");
    return null;
  }
  const shot = await deps.launchCamera(CAMERA_OPTIONS);
  if (shot.canceled || !shot.assets || shot.assets.length === 0) return null;
  return shot.assets[0].uri;
}

// ---- what the phone shows (pure; App.tsx and OnboardingScreen render from these) ----

export type RootScreen = "login" | "onboarding" | "main";

/** App.tsx: an applicant is kept signed in and lands on onboarding; "unknown" (dead zone) is trusted as before. */
export function rootScreen(kind: SessionKind, wantsOnboarding: boolean): RootScreen {
  if (kind === "applicant") return "onboarding";
  if (kind === "none") return wantsOnboarding ? "onboarding" : "login";
  return "main";
}

export type Stage = "form" | "pending" | "approved" | "rejected";

/** OnboardingScreen: no application → the form; otherwise the status read from onboarding_applications. */
export function stageOf(app: MyApplication | null): Stage {
  if (!app) return "form";
  return app.status;
}

export const STAGE_TEXT: Record<Exclude<Stage, "form">, { title: string; body: string }> = {
  pending: { title: "Cererea e în verificare", body: "Dispeceratul îți verifică datele și buletinul. Te anunțăm când e gata — de obicei în 1-2 zile lucrătoare." },
  approved: { title: "Cererea a fost aprobată", body: "Contul tău de curier e activ. Intră în tură și pornește prima livrare." },
  rejected: { title: "Cererea a fost respinsă", body: "Poți trimite o cerere nouă cu datele corectate." },
};
