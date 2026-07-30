"""Faza 4 — cele 3 întrebări ale auditului + testele de validare structurală.

Rulează:  .venv/bin/python experiments.py all      (sau q1|q2|q3|validate)
Ieșire:   tabele pe stdout + CSV în runs/ (fiecare cifră din raport are un CSV).
"""
from __future__ import annotations

import csv
import pathlib
import sys

from sim import load_params, run_reps

RUNS = pathlib.Path(__file__).parent / "runs"
RUNS.mkdir(exist_ok=True)
P = load_params()
REPS, SEED = 5, 42
COLS = ["scenario", "assign_med", "assign_p90", "total_med", "total_p90",
        "unassigned_pct", "waves_avg", "deliveries_per_courier", "utilization_pct", "ghosted"]


def save(name: str, rows: list[dict]):
    with open(RUNS / f"{name}.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=COLS)
        w.writeheader()
        [w.writerow({k: r.get(k, "") for k in COLS}) for r in rows]
    print(f"\n== {name} ==")
    print(" | ".join(COLS))
    for r in rows:
        print(" | ".join(str(r.get(k, "")) for k in COLS))


def q1_radius():
    """Q1: raza maximă de ofertă — unde se optimizează împreună P90 total + neasignate?"""
    rows = []
    for cap in [2, 3, 4, 6, None]:
        r = run_reps(P, REPS, SEED, mode="greedy", radius_cap_km=cap)
        r["scenario"] = f"cap={cap or 'inf'}km"
        rows.append(r)
    save("q1_radius", rows)


def q2_delta():
    """Q2: fereastra de acumulare Δ înainte de prima ofertă (FOODMATCH 1-4 min)."""
    rows = []
    for delta in [0, 0.5, 1, 2, 3]:
        r = run_reps(P, REPS, SEED, mode="greedy", delta_min=float(delta))
        r["scenario"] = f"greedy Δ={delta}min"
        rows.append(r)
    save("q2_delta", rows)


def q3_density():
    """Q3: crossover greedy-cascade vs matching global (ungar) pe densități."""
    rows = []
    base_fleet = P["fleet"]
    for orders in [30, 60, 120, 240, 480]:
        for scale, label in [(1, "10c"), (2, "20c")]:
            fleet = {v: n * scale for v, n in base_fleet.items()}
            for mode in ["greedy", "global"]:
                r = run_reps(P, REPS, SEED, mode=mode, orders_per_day=orders, fleet=fleet)
                r["scenario"] = f"{orders}/zi {label} {mode}"
                rows.append(r)
    save("q3_density", rows)
    # crossover-ul: global mai bun cu >10% pe mediana totală (pragul Faza 6)
    print("\n-- crossover (câștig global vs greedy pe total_med) --")
    for i in range(0, len(rows), 2):
        g, gl = rows[i], rows[i + 1]
        gain = (g["total_med"] - gl["total_med"]) / g["total_med"] * 100
        print(f"{g['scenario'][:14]:16s} câștig global: {gain:+.1f}%  {'<<< TRIGGER' if gain > 10 else ''}")


def validate():
    """Determinism + teste de semn (bara auditului: acuratețe direcțională)."""
    a = run_reps(P, 3, SEED, mode="greedy")
    b = run_reps(P, 3, SEED, mode="greedy")
    print(f"determinism: {'PASS — identic' if a == b else 'FAIL — diferă!'}")
    dbl = run_reps(P, 3, SEED, mode="greedy", fleet={v: n * 2 for v, n in P["fleet"].items()})
    print(f"semn 2×flotă: assign {a['assign_med']}→{dbl['assign_med']} min "
          f"{'PASS' if dbl['assign_med'] <= a['assign_med'] else 'FAIL'}")
    bikes = run_reps(P, 3, SEED, mode="greedy", fleet={"bike": 10})
    print(f"semn flotă-lentă: total {a['total_med']}→{bikes['total_med']} min "
          f"{'PASS' if bikes['total_med'] >= a['total_med'] else 'FAIL'}")
    surge = run_reps(P, 3, SEED, mode="greedy", orders_per_day=200)
    worse = surge["unassigned_pct"] >= a["unassigned_pct"] and surge["assign_med"] >= a["assign_med"]
    print(f"semn 5×cerere: unassigned {a['unassigned_pct']}%→{surge['unassigned_pct']}%, "
          f"assign {a['assign_med']}→{surge['assign_med']} min {'PASS' if worse else 'FAIL'}")
    sane = 25 <= a["total_med"] <= 70
    print(f"ancoră sanity (25-70 min, Wolt 35 / Straus 49): total_med={a['total_med']} "
          f"{'PASS' if sane else 'FAIL'}")


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"
    if what in ("validate", "all"):
        validate()
    if what in ("q1", "all"):
        q1_radius()
    if what in ("q2", "all"):
        q2_delta()
    if what in ("q3", "all"):
        q3_density()
