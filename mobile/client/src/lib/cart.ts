import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { EMPTY_CART, type CartState } from "@chisinau/shared-domain";

// App-wide cart (the web keeps it in a persisted Zustand store). The RULES live in
// @chisinau/shared-domain/cart — this file only holds + persists the state, so the
// cart survives navigating away from the restaurant and an app restart.
const KEY = "chisinau-delivery-cart";

let state: CartState = EMPTY_CART;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function getCart(): CartState {
  return state;
}

export function setCart(next: CartState | ((prev: CartState) => CartState)) {
  state = typeof next === "function" ? next(state) : next;
  emit();
  AsyncStorage.setItem(KEY, JSON.stringify(state)).catch(() => {
    /* persistence is a convenience; the in-memory cart still works */
  });
}

export function clearCart() {
  setCart(EMPTY_CART);
}

export async function hydrateCart(): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as CartState;
    if (parsed && Array.isArray(parsed.lines) && state.lines.length === 0) {
      state = parsed;
      emit();
    }
  } catch {
    /* corrupt / unavailable — start empty */
  }
}

export function useCart(): CartState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    getCart,
    getCart,
  );
}
