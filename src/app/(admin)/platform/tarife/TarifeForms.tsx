"use client";

import { useActionState } from "react";
import { setPricingAction, setTariffAction, type ActionState } from "./actions";

const input =
  "rounded-xl bg-white/5 px-4 py-2.5 text-sm text-white placeholder-white/35 ring-1 ring-white/10 outline-none focus:ring-primary/60 [color-scheme:dark]";

function Field({ label, name, defaultValue, step = "0.01", type = "number" }: {
  label: string; name: string; defaultValue?: string | number; step?: string; type?: string;
}) {
  return (
    <label className="flex flex-col gap-1 text-xs text-white/50">
      {label}
      <input name={name} type={type} step={type === "number" ? step : undefined} min={type === "number" ? 0 : undefined}
        defaultValue={defaultValue} className={input} required={type === "number"} />
    </label>
  );
}

function Common() {
  return (
    <>
      <label className="flex flex-col gap-1 text-xs text-white/50">
        Începe (ora Chișinăului; gol = acum)
        <input name="effective_from" type="datetime-local" className={input} />
      </label>
      <label className="flex min-w-64 flex-1 flex-col gap-1 text-xs text-white/50">
        Motivul schimbării (rămâne în istoric)
        <input name="note" required minLength={5} className={input} placeholder="ex. ajustare după pilot, aprobat de fondator" />
      </label>
    </>
  );
}

function Result({ state }: { state: ActionState }) {
  if (state.error) return <p role="alert" className="text-sm text-primary">{state.error}</p>;
  if (state.ok) return <p role="status" className="text-sm text-emerald-300">{state.ok}</p>;
  return null;
}

export function PricingForm({ courierPct, restaurantPct }: { courierPct: number; restaurantPct: number }) {
  const [state, action, pending] = useActionState(setPricingAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
      <h2 className="font-medium text-white">Versiune nouă de comisioane</h2>
      <p className="text-sm text-white/50">Plățile folosesc versiunea valabilă la momentul livrării fiecărei comenzi; o versiune nu poate începe în trecut.</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Comision curier (%)" name="courier_pct" defaultValue={courierPct} />
        <Field label="Comision restaurant (%)" name="restaurant_pct" defaultValue={restaurantPct} />
        <Common />
        <button disabled={pending} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? "Se salvează…" : "Salvează versiunea"}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}

export function TariffForm(props: { base: number; perKm: number; waitMin: number; grace: number; weather: number }) {
  const [state, action, pending] = useActionState(setTariffAction, { error: null });
  return (
    <form action={action} className="flex flex-col gap-3 rounded-2xl bg-white/[0.04] p-5 ring-1 ring-white/[0.06]">
      <h2 className="font-medium text-white">Tarif nou pentru curieri</h2>
      <p className="text-sm text-white/50">Tariful e un minim: se fixează pe comandă când devine „gata”. Curierii activi primesc anunțul.</p>
      <div className="flex flex-wrap items-end gap-3">
        <Field label="Bază (MDL)" name="base_mdl" defaultValue={props.base} />
        <Field label="Pe km (MDL)" name="per_km_mdl" defaultValue={props.perKm} />
        <Field label="Așteptare / min (MDL)" name="wait_per_min_mdl" defaultValue={props.waitMin} />
        <Field label="Grație (min)" name="wait_grace_minutes" defaultValue={props.grace} step="1" />
        <Field label="Suprataxă vreme (MDL)" name="weather_surcharge_mdl" defaultValue={props.weather} />
        <Common />
        <button disabled={pending} className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {pending ? "Se salvează…" : "Salvează tariful"}
        </button>
      </div>
      <Result state={state} />
    </form>
  );
}
