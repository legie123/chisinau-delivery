"""Pilot 5×5 — scenariul cerut de proprietar: 5 restaurante, 5 curieri,
15 comenzi/restaurant/zi (75/zi), cu mecanica REALĂ de azi, inclusiv plafonul
de numerar introdus pe 13 august (dispatch cash-aware + courier_has_capacity).

Rulează:  .venv/bin/python scenario_pilot.py
"""
from __future__ import annotations

import json
import pathlib
import sys

from sim import load_params, run_reps

HERE = pathlib.Path(__file__).parent

# 5 restaurante reale din seed, alese să acopere orașul (NE, V, E, SE, centru).
REST_5 = [
    [47.06800, 28.86000],
    [47.04100, 28.80200],
    [47.03300, 28.90400],
    [47.01150, 28.86000],
    [47.02300, 28.83500],
]
# 5 curieri — mix plauzibil de lansare.
FLEET_5 = {"car": 2, "scooter": 1, "e_bike": 1, "bike": 1}
ORDERS = 5 * 15  # 15 comenzi/restaurant/zi

# [DB 2026-08-15] mediană 370 MDL, p90 883, 74% cash; plafon 1000 pentru
# curieri sub 30 de zile (TOȚI la lansare), 1500 după; predare la sediu.
CASH_BASE = {
    "cap_mdl": 1000.0,
    "p_cash": 0.74,
    "cod_cap_mdl": 1400.0,
    "offload_at_pct": 0.75,
    "offload_minutes": 10.0,   # predare la ghișeu; drumul se adaugă separat
    "hq": [47.0245, 28.8322],
    "order_median_mdl": 370.0,
    "order_p90_mdl": 883.0,
}


def variant(**over) -> dict:
    return {**CASH_BASE, **over}


SCENARIOS = [
    ("A. fără model de numerar (cum arăta Faza 4)", None),
    ("B. REALITATEA de azi — plafon 1000, 74% cash", variant()),
    ("C. plafon 1500 (curieri > 30 zile)", variant(cap_mdl=1500.0)),
    ("D. plafon 1500 + cash împins la 40%", variant(cap_mdl=1500.0, p_cash=0.40)),
    ("E. D + predare rapidă la restaurant (3 min)", variant(cap_mdl=1500.0, p_cash=0.40, offload_minutes=3.0)),
]


def main() -> int:
    params = load_params()
    params["demand"]["workday_minutes"] = 14 * 60  # 09:00-23:00
    rows = []
    for label, cash in SCENARIOS:
        r = run_reps(params, reps=7, base_seed=42, orders_per_day=ORDERS,
                     fleet=FLEET_5, restaurants=REST_5, cash=cash)
        r["scenario"] = label
        rows.append(r)
        print(f"\n=== {label} ===")
        print(f"  livrate            {r['delivered']:>6} / {r['eligible']} eligibile")
        print(f"  NEONORATE          {r['unassigned_pct']:>6}%")
        print(f"  timp până la curier med {r['assign_med']:>5} min · p90 {r['assign_p90']} min")
        print(f"  comandă→ușă        med {r['total_med']:>5} min · p90 {r['total_p90']} min")
        print(f"  livrări/curier     {r['deliveries_per_courier']:>6}")
        print(f"  utilizare (14h)    {r['utilization_pct']:>6}%")
        print(f"  curieri ghost      {r['ghosted']:>6}")
        if "offloads_per_courier" in r:
            print(f"  predări numerar/curier {r['offloads_per_courier']:>4}"
                  f"  ({r['offload_min_per_courier']} min pierduți, {r['cash_time_share_pct']}% din timpul ocupat)")
            print(f"  oferte blocate de plafon {r['cash_skips']:>4}"
                  f"  · comenzi rămase fără curier DOAR din cauza numerarului: {r['cash_starved_orders']}")
    (HERE / "runs").mkdir(exist_ok=True)
    out = HERE / "runs" / "pilot_5x5x15.json"
    out.write_text(json.dumps(rows, indent=2, ensure_ascii=False))
    print(f"\n→ {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
