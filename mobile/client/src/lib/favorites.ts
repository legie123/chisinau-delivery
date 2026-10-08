import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { supabase } from "./supabase";
import { currentUserId } from "./api";

// Favorite restaurants — the same `favorites` table + writes as the web FavoriteButton.
// RLS `favorites_self` (for all to authenticated, using/with check customer_id = auth.uid())
// is the boundary; customer_id is passed explicitly because the column has no default.

export async function fetchFavoriteIds(): Promise<{ userId: string | null; ids: Set<string> }> {
  const userId = await currentUserId();
  if (!userId) return { userId: null, ids: new Set() };
  const { data, error } = await supabase.from("favorites").select("restaurant_id").eq("customer_id", userId);
  if (error) throw new Error(error.message);
  return { userId, ids: new Set((data ?? []).map((f) => f.restaurant_id)) };
}

export async function setFavorite(userId: string, restaurantId: string, on: boolean): Promise<void> {
  const { error } = on
    ? await supabase.from("favorites").insert({ customer_id: userId, restaurant_id: restaurantId })
    : await supabase.from("favorites").delete().eq("customer_id", userId).eq("restaurant_id", restaurantId);
  // 23505 = already a favorite (double tap from another screen): the end state is what we wanted.
  if (error && error.code !== "23505") throw new Error(error.message);
}

/** Favorite ids, re-read on every focus (sign-in/out and the other screen's taps show up).
 *  toggle(): signed out -> Login; else optimistic flip, rolled back if the write fails. */
export function useFavorites(navigation: { navigate: (name: string) => void }) {
  const [ids, setIdsState] = useState<Set<string>>(new Set());
  // Mirror so toggle() decides from the current set synchronously (an updater fn runs later).
  const idsRef = useRef(ids);
  const setIds = useCallback((next: Set<string>) => { idsRef.current = next; setIdsState(next); }, []);
  const pending = useRef(new Set<string>());

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      fetchFavoriteIds()
        .then((r) => { if (!cancelled) setIds(r.ids); })
        .catch(() => { /* offline: hearts stay as they were */ });
      return () => { cancelled = true; };
    }, [setIds]),
  );

  const toggle = useCallback(async (restaurantId: string) => {
    if (pending.current.has(restaurantId)) return; // claimed before any await: a double tap is one write
    pending.current.add(restaurantId);
    try {
      const userId = await currentUserId();
      if (!userId) {
        navigation.navigate("Login");
        return;
      }
      const next = !idsRef.current.has(restaurantId);
      const flip = (on: boolean) => {
        const copy = new Set(idsRef.current);
        if (on) copy.add(restaurantId);
        else copy.delete(restaurantId);
        setIds(copy);
      };
      flip(next); // optimistic
      try {
        await setFavorite(userId, restaurantId, next);
      } catch {
        flip(!next);
        Alert.alert("Favorite", "Nu am putut salva. Verifică conexiunea și încearcă din nou.");
      }
    } finally {
      pending.current.delete(restaurantId);
    }
  }, [navigation, setIds]);

  return { ids, toggle };
}
