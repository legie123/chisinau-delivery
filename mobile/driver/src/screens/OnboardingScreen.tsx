import React, { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Image,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import * as ImagePicker from "expo-image-picker";
import { COLORS } from "../theme";
import { supabase } from "../lib/supabase";
import {
  DEFAULT_CITY,
  STAGE_TEXT,
  VEHICLE_LABELS,
  VEHICLE_TYPES,
  attachIdPhoto,
  captureIdPhoto,
  fetchMyApplication,
  sessionKind,
  signInOrSignUp,
  stageOf,
  submitApplication,
  validateForm,
  type ApplicationForm,
  type FormErrors,
  type MyApplication,
  type SubmitDeps,
  type VehicleType,
} from "../lib/onboarding";

// Courier self-registration from the phone (K5): account → form (nume, telefon, oraș, vehicul,
// poză buletin) → submit_onboarding_application + kyc-documents upload → "în verificare" read back
// from onboarding_applications (RLS onboarding_self_read). All decisions live in ../lib/onboarding.

interface Props {
  signedIn: boolean; // true: signed in without a couriers row (App.tsx "applicant")
  onCourier: () => void; // the account turned out to be / became a courier's → App re-checks
  onBack: () => void; // back to the login screen (only before signing in)
}

const DEPS: SubmitDeps = {
  readFile: async (uri) => (await fetch(uri)).arrayBuffer(),
  now: Date.now,
  rand: () => Math.random().toString(36).slice(2),
};

const EMPTY: ApplicationForm = { fullName: "", phone: "", city: DEFAULT_CITY, vehicleType: "bike", photoUri: null };

export default function OnboardingScreen({ signedIn, onCourier, onBack }: Props) {
  const [hasSession, setHasSession] = useState(signedIn);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [application, setApplication] = useState<MyApplication | null>(null);
  const [form, setForm] = useState<ApplicationForm>(EMPTY);
  const [errors, setErrors] = useState<FormErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [docError, setDocError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [retake, setRetake] = useState(false); // rejected → fresh form over the old application

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setApplication(await fetchMyApplication(supabase));
    } catch {
      setLoadError("Nu am putut citi starea cererii. Verifică semnalul și încearcă din nou.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (hasSession) void load();
  }, [hasSession, load]);

  async function handleAccount() {
    setError(null);
    setPending(true);
    const message = await signInOrSignUp(supabase, email, password);
    if (message) {
      setPending(false);
      setError(message);
      return;
    }
    // An existing courier who tapped "Devino curier" by mistake goes straight in.
    const kind = await sessionKind(supabase);
    setPending(false);
    if (kind === "courier") return onCourier();
    setHasSession(true);
  }

  async function handlePhoto() {
    const uri = await captureIdPhoto({
      requestCamera: ImagePicker.requestCameraPermissionsAsync,
      launchCamera: ImagePicker.launchCameraAsync,
      alert: Alert.alert,
    });
    if (uri) setForm((f) => ({ ...f, photoUri: uri }));
  }

  async function handleSubmit() {
    const next = validateForm(form);
    setErrors(next);
    if (Object.keys(next).length > 0) return;
    setError(null);
    setPending(true);
    const out = await submitApplication(supabase, form, DEPS);
    setPending(false);
    if (!out.ok) return setError(out.error);
    setDocError(out.docError);
    setRetake(false);
    await load();
  }

  async function handleRetryPhoto() {
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user.id;
    if (!userId || !application || !form.photoUri) return;
    setPending(true);
    const err = await attachIdPhoto(supabase, userId, application.id, form.photoUri, DEPS);
    setPending(false);
    setDocError(err);
    if (!err) await load();
  }

  function set<K extends keyof ApplicationForm>(key: K, value: ApplicationForm[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  const signOut = () => void supabase.auth.signOut({ scope: "local" });

  let body: React.ReactNode;
  if (!hasSession) {
    body = (
      <>
        <Text style={styles.subtitle}>Creează-ți contul de curier</Text>
        <TextInput
          style={styles.input}
          placeholder="Email"
          placeholderTextColor={COLORS.textMuted}
          autoCapitalize="none"
          keyboardType="email-address"
          value={email}
          onChangeText={setEmail}
        />
        <TextInput
          style={styles.input}
          placeholder="Parolă (minim 6 caractere)"
          placeholderTextColor={COLORS.textMuted}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
        />
        {error && <Text style={styles.error}>{error}</Text>}
        <Button label="Continuă" onPress={handleAccount} pending={pending} />
        <TouchableOpacity onPress={onBack} style={styles.link}>
          <Text style={styles.linkText}>Am deja cont de curier — intră în tură</Text>
        </TouchableOpacity>
      </>
    );
  } else if (loading) {
    body = <ActivityIndicator color={COLORS.primary} style={{ marginTop: 32 }} />;
  } else if (loadError) {
    body = (
      <>
        <Text style={styles.error}>{loadError}</Text>
        <Button label="Încearcă din nou" onPress={load} pending={false} />
      </>
    );
  } else if (stageOf(application) === "form" || retake) {
    body = (
      <>
        <Text style={styles.subtitle}>Completează cererea — o verificăm și îți activăm contul</Text>
        <Field error={errors.fullName}>
          <TextInput style={styles.input} placeholder="Nume complet" placeholderTextColor={COLORS.textMuted} value={form.fullName} onChangeText={(v) => set("fullName", v)} />
        </Field>
        <Field error={errors.phone}>
          <TextInput style={styles.input} placeholder="Telefon (ex. 069 123 456)" placeholderTextColor={COLORS.textMuted} keyboardType="phone-pad" value={form.phone} onChangeText={(v) => set("phone", v)} />
        </Field>
        <Field error={errors.city}>
          <TextInput style={styles.input} placeholder="Oraș" placeholderTextColor={COLORS.textMuted} value={form.city} onChangeText={(v) => set("city", v)} />
        </Field>
        <Text style={styles.label}>Cu ce livrezi?</Text>
        <View style={styles.chips}>
          {VEHICLE_TYPES.map((v: VehicleType) => (
            <TouchableOpacity key={v} style={[styles.chip, form.vehicleType === v && styles.chipOn]} onPress={() => set("vehicleType", v)}>
              <Text style={[styles.chipText, form.vehicleType === v && styles.chipTextOn]}>{VEHICLE_LABELS[v]}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Field error={errors.photoUri}>
          <TouchableOpacity style={styles.photoBtn} onPress={() => void handlePhoto()}>
            {form.photoUri ? <Image source={{ uri: form.photoUri }} style={styles.photo} accessibilityLabel="Poza buletinului" /> : null}
            <Text style={styles.photoText}>{form.photoUri ? "Poză făcută — atinge ca să refaci" : "Fă o poză la buletin"}</Text>
          </TouchableOpacity>
        </Field>
        {error && <Text style={styles.error}>{error}</Text>}
        <Button label="Trimite cererea" onPress={handleSubmit} pending={pending} />
        <TouchableOpacity onPress={signOut} style={styles.link}>
          <Text style={styles.linkText}>Ieși din cont</Text>
        </TouchableOpacity>
      </>
    );
  } else {
    const stage = stageOf(application) as Exclude<ReturnType<typeof stageOf>, "form">;
    const text = STAGE_TEXT[stage];
    body = (
      <>
        <Text style={styles.stageTitle}>{text.title}</Text>
        <Text style={styles.stageBody}>{text.body}</Text>
        {application?.reviewNote ? <Text style={styles.note}>Notă de la dispecerat: {application.reviewNote}</Text> : null}
        {docError ? (
          <View style={styles.warnBox}>
            <Text style={styles.warnText}>Poza buletinului nu s-a încărcat: {docError}</Text>
            <Button label="Reîncearcă poza" onPress={handleRetryPhoto} pending={pending} />
          </View>
        ) : null}
        {stage === "pending" && application?.docs === 0 && !docError ? (
          <Text style={styles.warnText}>Cererea nu are poza buletinului atașată — dispeceratul te va contacta.</Text>
        ) : null}
        {stage === "approved" ? <Button label="Intră în tură" onPress={onCourier} pending={false} /> : null}
        {stage === "rejected" ? <Button label="Trimite altă cerere" onPress={() => setRetake(true)} pending={false} /> : null}
        {stage === "pending" ? <Button label="Verifică din nou" onPress={load} pending={loading} /> : null}
        <TouchableOpacity onPress={signOut} style={styles.link}>
          <Text style={styles.linkText}>Ieși din cont</Text>
        </TouchableOpacity>
      </>
    );
  }

  return (
    <ScrollView style={styles.scroll} contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <Text style={styles.logo}>🐉</Text>
      <Text style={styles.title}>DEVINO CURIER</Text>
      {body}
    </ScrollView>
  );
}

function Field({ error, children }: { error?: string; children: React.ReactNode }) {
  return (
    <View>
      {children}
      {error ? <Text style={styles.fieldError}>{error}</Text> : null}
    </View>
  );
}

function Button({ label, onPress, pending }: { label: string; onPress: () => void | Promise<void>; pending: boolean }) {
  return (
    <TouchableOpacity style={styles.button} onPress={() => void onPress()} disabled={pending}>
      {pending ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.buttonText}>{label}</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, backgroundColor: COLORS.background },
  container: { flexGrow: 1, justifyContent: "center", paddingHorizontal: 32, paddingVertical: 48 },
  logo: { fontSize: 56, textAlign: "center", marginBottom: 8 },
  title: { color: COLORS.gold, fontSize: 22, fontWeight: "800", textAlign: "center", letterSpacing: 2 },
  subtitle: { color: COLORS.textSecondary, textAlign: "center", marginBottom: 24 },
  input: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.border,
    borderWidth: 1,
    borderRadius: 12,
    color: COLORS.white,
    paddingHorizontal: 16,
    paddingVertical: 14,
    marginBottom: 12,
    fontSize: 15,
  },
  label: { color: COLORS.textSecondary, marginBottom: 8, marginTop: 4 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: COLORS.border, backgroundColor: COLORS.surface, paddingHorizontal: 14, paddingVertical: 8 },
  chipOn: { borderColor: COLORS.primary, backgroundColor: COLORS.primary + "22" },
  chipText: { color: COLORS.textSecondary, fontWeight: "600" },
  chipTextOn: { color: COLORS.white },
  photoBtn: { borderRadius: 12, borderWidth: 1, borderStyle: "dashed", borderColor: COLORS.gold, padding: 14, alignItems: "center", marginBottom: 12, gap: 8 },
  photo: { width: 160, height: 100, borderRadius: 8 },
  photoText: { color: COLORS.gold, fontWeight: "600" },
  fieldError: { color: COLORS.error, fontSize: 12, marginTop: -6, marginBottom: 10 },
  error: { color: COLORS.error, textAlign: "center", marginBottom: 8 },
  button: { backgroundColor: COLORS.primary, borderRadius: 999, paddingVertical: 16, alignItems: "center", marginTop: 8 },
  buttonText: { color: COLORS.white, fontWeight: "700", fontSize: 16 },
  link: { marginTop: 18, alignItems: "center" },
  linkText: { color: COLORS.textSecondary, textDecorationLine: "underline" },
  stageTitle: { color: COLORS.white, fontSize: 20, fontWeight: "700", textAlign: "center", marginTop: 16, marginBottom: 8 },
  stageBody: { color: COLORS.textSecondary, textAlign: "center", marginBottom: 16, lineHeight: 20 },
  note: { color: COLORS.gold, textAlign: "center", marginBottom: 12 },
  warnBox: { borderWidth: 1, borderColor: "rgba(212,175,55,0.5)", borderRadius: 12, padding: 12, marginBottom: 12 },
  warnText: { color: COLORS.warning, textAlign: "center", marginBottom: 8 },
});
