"""Unde se rupe pilotul 5×5: creștem cererea peste 75/zi, cu flota fixă de 5,
în regimul de AZI (plafon 1000, 74% cash) vs regimul REPARAT (plafon 1500,
40% cash). Răspunde la „cât mai suportăm înainte să adăugăm curieri?".

Rulează:  .venv/bin/python scenario_stress.py
"""
from __future__ import annotations

import json
import pathlib
import sys

from scenario_pilot import CASH_BASE, FLEET_5, REST_5, variant
from sim import load_params, run_reps

HERE = pathlib.Path(__file__).parent
LOADS = [75, 100, 125, 150, 200]
REGIMES = [
    ("AZI  (plafon 1000, 74% cash)", CASH_BASE),
    ("REPARAT (plafon 1500, 40% cash)", variant(cap_mdl=1500.0, p_cash=0.40)),
]


def main() -> int:
    params = load_params()
    params["demand"]["workday_minutes"] = 14 * 60
    rows = []
    for label, cash in REGIMES:
        print(f"\n=== {label} · flotă fixă 5 curieri ===")
        print(f"  {'comenzi/zi':>10} {'neonorate':>10} {'p90 până la curier':>19} {'p90 la ușă':>12} {'utilizare':>10} {'predări':>8}")
        for load in LOADS:
            r = run_reps(params, reps=7, base_seed=42, orders_per_day=load,
                         fleet=FLEET_5, restaurants=REST_5, cash=cash)
            r["scenario"], r["load"] = label, load
            rows.append(r)
            print(f"  {load:>10} {r['unassigned_pct']:>9}% {r['assign_p90']:>16} min"
                  f" {r['total_p90']:>9} min {r['utilization_pct']:>9}% {r['offloads_per_courier']:>8}")
    (HERE / "runs").mkdir(exist_ok=True)
    out = HERE / "runs" / "stress_5couriers.json"
    out.write_text(json.dumps(rows, indent=2, ensure_ascii=False))
    print(f"\n→ {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
