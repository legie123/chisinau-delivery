import type { PlaceOrderInput } from "@chisinau/shared-api";
import { placeOrderItems, selectionIsValid, type CartLine, type OptionGroupLike, type Selection } from "@chisinau/shared-domain";

// The catering request (place_order, order_type='catering'), built and checked in ONE
// place. Lines use the shared cart model, so a line carries its chosen options the
// same way a delivery cart line does. Pure: no React Native imports.

export type CateringForm = { date: string; time: string; guests: string; address: string; person: string; phone: string; notes: string };

/** What place_order would reject, said first and in Romanian; null = sendable. */
export function cateringProblem(
  lines: CartLine[],
  items: { id: string; name: string; cateringMinQty: number | null }[],
  groups: Record<string, OptionGroupLike[]>,
): string | null {
  if (lines.length === 0) return "Alege cel puțin un articol pentru eveniment.";
  for (const line of lines) {
    const item = items.find((i) => i.id === line.menuItemId);
    if (!item) return "Un articol din selecție nu mai este disponibil — reîncarcă.";
    if (item.cateringMinQty != null && line.quantity < item.cateringMinQty) {
      return `„${item.name}” se comandă de la minim ${item.cateringMinQty} buc.`;
    }
    const itemGroups = groups[item.id] ?? [];
    const selection: Selection = {};
    for (const g of itemGroups) selection[g.id] = line.optionIds.filter((id) => g.options.some((o) => o.id === id));
    const known = Object.values(selection).flat().length === line.optionIds.length;
    if (!known || !selectionIsValid(itemGroups, selection)) {
      return `„${item.name}” are opțiuni obligatorii — alege-le înainte să trimiți cererea.`;
    }
  }
  return null;
}

export function buildCateringInput(opts: {
  restaurantId: string;
  lines: CartLine[];
  form: CateringForm;
  requestedFor: string;
  idempotencyKey: string;
}): PlaceOrderInput {
  const { form } = opts;
  return {
    restaurantId: opts.restaurantId,
    orderType: "catering",
    paymentMethod: "cash",
    items: placeOrderItems(opts.lines),
    requestedFor: opts.requestedFor,
    notes: form.notes.trim() || undefined,
    // One key per attempt: a double tap / timeout retry returns the SAME request.
    idempotencyKey: opts.idempotencyKey,
    catering: {
      event_date: form.date,
      event_time: form.time || "",
      guest_count: Math.max(1, parseInt(form.guests, 10) || 1),
      event_address_text: form.address.trim(),
      contact_person: form.person.trim(),
      contact_phone: form.phone.trim(),
    },
  };
}
