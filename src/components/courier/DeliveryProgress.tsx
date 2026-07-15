import type { Order } from "@/lib/types/domain";

// 4-step green progress from the courier video reference:
// Accepted -> Picked up -> In transit -> Delivered.
const STEPS = [
  { key: "courier_assigned", label: "Acceptată" },
  { key: "picked_up", label: "Ridicată" },
  { key: "en_route", label: "În tranzit" },
  { key: "delivered", label: "Livrată" },
] as const;

const STATUS_INDEX: Record<string, number> = {
  courier_assigned: 0,
  picked_up: 1,
  en_route: 2,
  delivered: 3,
};

export function DeliveryProgress({ status }: { status: Order["status"] }) {
  const current = STATUS_INDEX[status] ?? -1;
  if (current < 0) return null;

  return (
    <div className="mb-4 rounded-2xl bg-white/[0.04] px-5 py-4 ring-1 ring-white/[0.06]">
      <div className="flex items-center">
        {STEPS.map((step, i) => (
          <div key={step.key} className={`flex items-center ${i < STEPS.length - 1 ? "flex-1" : ""}`}>
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={`flex h-4 w-4 items-center justify-center rounded-full ring-2 ${
                  i <= current
                    ? "bg-emerald-400 ring-emerald-400"
                    : "bg-transparent ring-white/20"
                } ${i === current && status !== "delivered" ? "animate-pulse" : ""}`}
                aria-hidden
              />
              <span className={`whitespace-nowrap text-[11px] ${i <= current ? "font-semibold text-white" : "text-white/40"}`}>
                {step.label}
              </span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={`mx-1.5 mb-5 h-0.5 flex-1 rounded ${i < current ? "bg-emerald-400" : "bg-white/15"}`} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
