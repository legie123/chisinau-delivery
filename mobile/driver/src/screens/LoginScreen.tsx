import React, { useState } from "react";
import { View, Text, TextInput, TouchableOpacity, StyleSheet, StatusBar, ActivityIndicator } from "react-native";
import { COLORS } from "../theme";
import { signIn } from "../lib/api";

interface Props {
  onSignedIn: () => void;
}

export default function LoginScreen({ onSignedIn }: Props) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function handleLogin() {
    setError(null);
    setPending(true);
    const message = await signIn(email.trim(), password);
    setPending(false);
    if (message) {
      setError(message); // Romanian: wrong credentials, no signal, or not a courier account
      return;
    }
    onSignedIn();
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <Text style={styles.logo}>🐉</Text>
      <Text style={styles.title}>DRAGONS COURIERS</Text>
      <Text style={styles.subtitle}>Cont curier</Text>

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

      <TouchableOpacity style={styles.button} onPress={handleLogin} disabled={pending}>
        {pending ? <ActivityIndicator color={COLORS.white} /> : <Text style={styles.buttonText}>Intră în tură</Text>}
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
  button: {
    backgroundColor: COLORS.primary,
    borderRadius: 999,
    paddingVertical: 16,
    alignItems: "center",
    marginTop: 8,
  },
  buttonText: { color: COLORS.white, fontWeight: "700", fontSize: 16 },
});
