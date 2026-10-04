"use server";

import { revalidatePath } from "next/cache";
import { mapPgError } from "@chisinau/shared-api";
import { requireOwnRestaurant } from "@/lib/auth/require";

export type ActionState = { error: string | null };

// Menu-modifier authoring for restaurant partners. RLS (menu_option_groups /
// menu_options staff_write) is the real boundary — every write is scoped to items
// of a restaurant the caller has_restaurant_access to. We also verify the target
// item/group belongs to the caller's restaurant first for a clean error.

async function ownsItem(supabase: Awaited<ReturnType<typeof requireOwnRestaurant>>["supabase"], restaurantId: string, itemId: string) {
  const { data } = await supabase.from("menu_items").select("id").eq("id", itemId).eq("restaurant_id", restaurantId).maybeSingle();
  return !!data;
}

// A group belongs to the restaurant iff its menu_item does. Resolve the item id
// first, then reuse ownsItem — same defense-in-depth over RLS as the menu deletes.
async function ownsGroup(supabase: Awaited<ReturnType<typeof requireOwnRestaurant>>["supabase"], restaurantId: string, groupId: string) {
  const { data } = await supabase.from("menu_option_groups").select("menu_item_id").eq("id", groupId).maybeSingle();
  if (!data?.menu_item_id) return false;
  return ownsItem(supabase, restaurantId, data.menu_item_id as string);
}

async function ownsOption(supabase: Awaited<ReturnType<typeof requireOwnRestaurant>>["supabase"], restaurantId: string, optionId: string) {
  const { data } = await supabase.from("menu_options").select("group_id").eq("id", optionId).maybeSingle();
  if (!data?.group_id) return false;
  return ownsGroup(supabase, restaurantId, data.group_id as string);
}

export async function createOptionGroup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, restaurantId } = await requireOwnRestaurant();
    const menuItemId = String(formData.get("menu_item_id") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    const isRequired = formData.get("is_required") === "on";
    const maxSelect = Math.max(1, Number(formData.get("max_select") ?? 1));
    if (!name) return { error: "Numele grupului este obligatoriu." };
    if (!(await ownsItem(supabase, restaurantId, menuItemId))) return { error: "Produs invalid." };

    // required ⇒ at least 1 must be picked; optional ⇒ min 0.
    const { error } = await supabase.from("menu_option_groups").insert({
      menu_item_id: menuItemId,
      name,
      is_required: isRequired,
      min_select: isRequired ? 1 : 0,
      max_select: maxSelect,
      sort_order: 0,
    });
    if (error) return { error: mapPgError(error) };
    revalidatePath("/restaurant/menu");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

export async function deleteOptionGroup(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, restaurantId } = await requireOwnRestaurant();
    const groupId = String(formData.get("group_id") ?? "");
    if (!(await ownsGroup(supabase, restaurantId, groupId))) return { error: "Grup invalid." };
    const { error } = await supabase.from("menu_option_groups").delete().eq("id", groupId);
    if (error) return { error: mapPgError(error) };
    revalidatePath("/restaurant/menu");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

export async function addOption(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, restaurantId } = await requireOwnRestaurant();
    const groupId = String(formData.get("group_id") ?? "");
    const name = String(formData.get("name") ?? "").trim();
    const priceDelta = Math.max(0, Number(formData.get("price_delta_mdl") ?? 0));
    if (!name) return { error: "Numele opțiunii este obligatoriu." };
    if (!(await ownsGroup(supabase, restaurantId, groupId))) return { error: "Grup invalid." };
    const { error } = await supabase.from("menu_options").insert({
      group_id: groupId,
      name,
      price_delta_mdl: priceDelta,
      is_available: true,
      sort_order: 0,
    });
    if (error) return { error: mapPgError(error) };
    revalidatePath("/restaurant/menu");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}

export async function deleteOption(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    const { supabase, restaurantId } = await requireOwnRestaurant();
    const optionId = String(formData.get("option_id") ?? "");
    if (!(await ownsOption(supabase, restaurantId, optionId))) return { error: "Opțiune invalidă." };
    const { error } = await supabase.from("menu_options").delete().eq("id", optionId);
    if (error) return { error: mapPgError(error) };
    revalidatePath("/restaurant/menu");
    return { error: null };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "A apărut o eroare." };
  }
}
