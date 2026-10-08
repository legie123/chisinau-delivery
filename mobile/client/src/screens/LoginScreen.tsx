import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator } from "react-native";
import { COLORS } from "../theme";
import { isSignedIn, signIn, signUp } from "../lib/api";
import { loginErrorText } from "../lib/errors";

interface Props {
  route: any;
  navigation: any;
}

export default function LoginScreen({ route, navigation }: Props) {
  const [mode, setMode] = useState<"sign-in" | "sign-up">("sign-in");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // No callback travels through the route params (a function there is non-serializable
  // and is lost on state restore): Login only signs in and goes back; every caller
  // re-reads the session on focus (useFocusEffect) or on its next action.
  async function handleSubmit() {
    setError(null);
    setNotice(null);
    if (mode === "sign-up" && !fullName.trim()) {
      setError("Numele este obligatoriu.");
      return;
    }
    setPending(true);
    const message =
      mode === "sign-up"
        ? await signUp(email.trim(), password, fullName.trim())
        : await signIn(email.trim(), password);
    const signedIn = !message && (await isSignedIn());
    setPending(false);
    if (message) {
      setError(loginErrorText(message));
      return;
    }
    if (!signedIn) {
      // Sign-up with email confirmation on: the account exists but there is no session yet.
      setMode("sign-in");
      setNotice("Cont creat. Confirmă emailul din mesajul primit, apoi autentifică-te.");
      return;
    }
    // Backward compatibility: ProfileScreen still passes `onSignedIn` (it also reloads on
    // focus, so the callback is redundant there). Nothing new should pass a function here.
    route.params?.onSignedIn?.();
    navigation.goBack();
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <Text style={styles.logo}>🐉</Text>
      <Text style={styles.title}>DRAGONS DELIVERY</Text>
      <Text style={styles.subtitle}>{mode === "sign-in" ? "Intră în cont" : "Cont nou"}</Text>

      {mode === "sign-up" && (
        <TextInput
          style={styles.input}
          placeholder="Nume complet"
          placeholderTextColor={COLORS.textMuted}
          value={fullName}
          onChangeText={setFullName}
        />
      )}
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
        placeholder="Parolă"
        placeholderTextColor={COLORS.textMuted}
        secureTextEntry
        value={password}
        onChangeText={setPassword}
      />

      {error && <Text style={styles.error}>{error}</Text>}
      {notice && <Text style={styles.notice}>{notice}</Text>}

      <TouchableOpacity style={styles.button} onPress={handleSubmit} disabled={pending}>
        {pending ? (
          <ActivityIndicator color={COLORS.white} />
        ) : (
          <Text style={styles.buttonText}>{mode === "sign-in" ? "Autentificare" : "Creează cont"}</Text>
        )}
      </TouchableOpacity>

      <TouchableOpacity onPress={() => setMode(mode === "sign-in" ? "sign-up" : "sign-in")}>
        <Text style={styles.switchText}>
          {mode === "sign-in" ? "Nu ai cont? Creează unul." : "Ai deja cont? Autentifică-te."}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    justifyContent: "center",
    paddingHorizontal: 32,
  },
  logo: { fontSize: 56, textAlign: "center", marginBottom: 8 },
  title: {
    color: COLORS.gold,
    fontSize: 22,
    fontWeight: "800",
    textAlign: "center",
    letterSpacing: 2,
  },
  subtitle: {
    color: COLORS.textSecondary,
    textAlign: "center",
    marginBottom: 32,
  },
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
  error: { color: COLORS.error, textAlign: "center", marginBottom: 8 },
  notice: { color: COLORS.gold, textAlign: "center", marginBottom: 8 },
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { color: COLORS.white, fontWeight: "700", fontSize: 16 },
  switchText: {
    color: COLORS.textSecondary,
    textAlign: "center",
    marginTop: 16,
    textDecorationLine: "underline",
  },
});
