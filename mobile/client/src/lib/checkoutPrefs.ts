import AsyncStorage from "@react-native-async-storage/async-storage";
import { parsePrefs, type CheckoutPrefs } from "./checkout";

// Last payment method + tip, restored on the next checkout (web keeps the same pair in
// localStorage). Saved only after a successful order. A convenience: never throws.
const KEY = "chisinau-checkout-prefs";

export async function loadCheckoutPrefs(): Promise<Partial<CheckoutPrefs>> {
  try {
    return parsePrefs(await AsyncStorage.getItem(KEY));
  } catch {
    return {};
  }
}

export function saveCheckoutPrefs(prefs: CheckoutPrefs): void {
  AsyncStorage.setItem(KEY, JSON.stringify(prefs)).catch(() => {});
}
