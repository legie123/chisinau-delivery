import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ORDER_STATUS_LABEL, type Order, type SelectedOption } from "@/lib/types/domain";
import { ReorderButton, type ReorderItem } from "@/components/customer/ReorderButton";
import { PushOptIn } from "@/components/shared/PushOptIn";
import { formatScheduledFor } from "@/lib/orders/scheduled";
import { paymentPresence } from "@/lib/orders/payment";

type OrderRow = Pick<
  Order,
  | "id"
  | "order_number"
  | "order_type"
  | "created_at"
  | "status"
  | "total_mdl"
  | "requested_for"
  | "payment_method"
  | "payment_status"
> & {
  restaurant_id: string;
  restaurants: { slug: string; name: string } | null;
  order_items: {
    menu_item_id: string | null;
    item_name_snapshot: string;
    unit_price_mdl: number;
    quantity: number;
    selected_options: SelectedOption[] | null;
  }[];
};

function statusTone(status: Order["status"]): string {
  if (status === "delivered") return "bg-emerald-500/15 text-emerald-400 ring-emerald-500/30";
  if (status === "cancelled" || status === "rejected") return "bg-primary/15 text-primary ring-primary/30";
  return "bg-gold/15 text-gold ring-gold/30";
}

export default async function OrdersPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return (
      <main className="flex-1 px-5 py-16 text-center">
        <p className="text-white/60">
          <Link href="/" className="text-primary underline underline-offset-4">
            Intră din sectorul Clienți
          </Link>{" "}
          ca să vezi comenzile tale.
        </p>
      </main>
    );
  }

  const { data: orders } = await supabase
    .from("orders")
    .select(
      "id, order_number, order_type, created_at, status, total_mdl, requested_for, payment_method, payment_status, restaurant_id, restaurants(slug, name), order_items(menu_item_id, item_name_snapshot, unit_price_mdl, quantity, selected_options)",
    )
    .eq("customer_id", user.id)
    .order("created_at", { ascending: false })
    .limit(30);

  const orderList = (orders ?? []) as unknown as OrderRow[];

  // Reorder replay (audit HIGH): a delivered item with a REQUIRED modifier group
  // used to be re-added with NO options → checkout dead-ended. We now replay the
  // ORIGINAL choices from each order_item's selected_options snapshot, mapping
  // (group name, option name) back to the CURRENT menu_options id. An item whose
  // menu changed so a required group is no longer covered is marked blocked and
  // skipped by the button (with a notice) instead of dead-ending checkout.
  const reorderMenuItemIds = [
    ...new Set(
      orderList
        .filter((o) => o.status === "delivered" && o.order_type === "standard")
        .flatMap((o) => o.order_items.map((it) => it.menu_item_id).filter((id): id is string => !!id)),
    ),
  ];
  const optionIdByKey = new Map<string, string>(); // `${menuItemId}|${group}|${name}` -> option id
  const requiredGroupsByItem = new Map<string, Set<string>>(); // menuItemId -> required group names
  if (reorderMenuItemIds.length > 0) {
    const { data: groups } = await supabase
      .from("menu_option_groups")
      .select("id, menu_item_id, name, min_select, menu_options(id, name)")
      .in("menu_item_id", reorderMenuItemIds);
    for (const g of (groups ?? []) as unknown as {
      id: string;
      menu_item_id: string;
      name: string;
      min_select: number;
      menu_options: { id: string; name: string }[];
    }[]) {
      if (g.min_select >= 1) {
        const set = requiredGroupsByItem.get(g.menu_item_id) ?? new Set<string>();
        set.add(g.name);
        requiredGroupsByItem.set(g.menu_item_id, set);
      }
      for (const opt of g.menu_options ?? []) {
        optionIdByKey.set(`${g.menu_item_id}|${g.name}|${opt.name}`, opt.id);
      }
    }
  }

  function buildReorderItems(order: OrderRow): ReorderItem[] {
    return order.order_items
      .filter((it) => it.menu_item_id)
      .map((it) => {
        const menuItemId = it.menu_item_id as string;
        const chosen = it.selected_options ?? [];
        const optionIds: string[] = [];
        const coveredGroups = new Set<string>();
        for (const sel of chosen) {
          const id = optionIdByKey.get(`${menuItemId}|${sel.group}|${sel.name}`);
          if (id) {
            optionIds.push(id);
            coveredGroups.add(sel.group);
          }
        }
        // blocked = a currently-required group isn't satisfied by the replayed options.
        const required = requiredGroupsByItem.get(menuItemId) ?? new Set<string>();
        const blocked = [...required].some((grp) => !coveredGroups.has(grp));
        return {
          menuItemId,
          name: it.item_name_snapshot,
          priceMdl: Number(it.unit_price_mdl),
          quantity: it.quantity,
          optionIds,
          optionsLabel: chosen.map((s) => s.name).join(", "),
          blocked,
        };
      });
  }
  const formatDate = new Intl.DateTimeFormat("ro-RO", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Europe/Chisinau",
  });

  return (
    <main className="flex-1 px-5 pb-24 pt-6">
      <h1 className="mb-4 text-2xl font-bold text-white">Comenzile mele</h1>
      {/* Web Push opt-in so status updates reach the customer with the tab closed
          (audit HIGH #3 — customers couldn't subscribe before). */}
      <div className="mb-6">
        <PushOptIn />
      </div>
      {orderList.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-20 text-center">
          <span className="text-6xl" aria-hidden>🍣</span>
          <p className="text-white/60">Nu ai plasat nicio comandă încă.</p>
          <Link
            href="/restaurants"
            className="rounded-full bg-primary-dark px-6 py-3 text-sm font-semibold text-white transition hover:bg-primary-darker"
          >
            Comandă acum
          </Link>
        </div>
      ) : (
        <ul className="flex flex-col gap-3">
          {orderList.map((order) => {
            const reorderItems = buildReorderItems(order);
            const pay = paymentPresence({
              method: order.payment_method,
              status: order.payment_status,
              orderStatus: order.status,
              amountMdl: order.total_mdl,
            });
            const payChip = pay.chip;
            const payTone = pay.notice?.tone;
            const canReorder =
              order.status === "delivered" &&
              order.order_type === "standard" &&
              order.restaurant_id != null &&
              reorderItems.length > 0;

            return (
              <li key={order.id} className="flex flex-col gap-2">
                <Link
                  href={order.order_type === "catering" ? `/catering/${order.id}` : `/orders/${order.id}`}
                  className="flex items-center justify-between gap-3 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06] transition hover:ring-white/20"
                >
                  <div className="min-w-0">
                    {/* #7 — restaurant name + a short item summary so the row is
                        recognizable at a glance, not just an opaque order number. */}
                    <p className="truncate font-semibold text-white">
                      {order.restaurants?.name ?? "Restaurant"}
                      {order.order_type === "catering" && <span className="ml-2 text-xs text-gold">CATERING</span>}
                    </p>
                    {order.order_items.length > 0 && (
                      <p className="mt-0.5 truncate text-sm text-white/60">
                        {order.order_items.map((it) => `${it.quantity}× ${it.item_name_snapshot}`).join(", ")}
                      </p>
                    )}
                    <p className="mt-0.5 text-xs text-white/40">
                      {order.order_number} · {formatDate.format(new Date(order.created_at))}
                      {order.requested_for && (
                        <span className="ml-1 text-sky-300/90">· 🕒 programată {formatScheduledFor(order.requested_for)}</span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    <div className="flex items-center gap-3">
                      <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${statusTone(order.status)}`}>
                        {ORDER_STATUS_LABEL[order.status]}
                      </span>
                      <span className="font-bold text-white">{order.total_mdl} MDL</span>
                    </div>
                    {/* Starea banilor apare DOAR când contrazice normalul (returnare,
                        plată eșuată, sumă doar rezervată). Pe drumul fericit rândul
                        rămâne exact cum era — altfel pastilele se devalorizează. */}
                    {payChip && (
                      <span
                        className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ring-1 ${
                          payTone === "good"
                            ? "bg-emerald-500/15 text-emerald-300 ring-emerald-500/30"
                            : "bg-amber-400/15 text-amber-200 ring-amber-400/30"
                        }`}
                      >
                        {payChip}
                      </span>
                    )}
                  </div>
                </Link>
                {canReorder && (
                  <ReorderButton
                    restaurantId={order.restaurant_id}
                    restaurantName={order.restaurants?.name ?? "Restaurant"}
                    restaurantSlug={order.restaurants?.slug ?? null}
                    items={reorderItems}
                  />
                )}
                {/* Catering-ul nu trece prin coș (are ofertă), deci nu poate
                    folosi butonul de mai sus — dar e exact segmentul care se
                    repetă cel mai des (audit de creștere 2026-08-15). Formularul
                    se redeschide pre-completat; se schimbă doar data. */}
                {order.status === "delivered" && order.order_type === "catering" && (
                  <Link
                    href={`/catering?repeta=${order.id}`}
                    className="self-start rounded-full bg-gold/15 px-4 py-2 text-sm font-semibold text-gold ring-1 ring-gold/30 transition hover:bg-gold/25"
                  >
                    Repetă comanda de catering
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
