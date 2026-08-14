"""Dragon Courier — simulator DES (SimPy) al mecanicii REALE de dispatch (Faza 4).

Fidel SQL-ului din repo (20260717001600 + 20260727001300 + 20260727001400):
ofertă push 30s către UN singur curier; sweeper la 15s (expirarea efectivă e
30-45s); refuz → cascadă imediată; max 5 valuri per rundă, apoi comanda așteaptă
și sweeper-ul re-încearcă; scor = ETA-la-restaurant (anonim — FĂRĂ termen de
acceptare); capacitate 1 livrare; ghost auto-offline la 3 expirări consecutive
(refuzurile NU contează). Modul "global" înlocuiește doar asignarea: la fiecare
tick, potrivire ungară (scipy) pe matricea ETA curieri-liberi × comenzi-gata.
"""
from __future__ import annotations

import dataclasses
import math
import pathlib

try:
    import tomllib  # py >= 3.11
except ModuleNotFoundError:  # py 3.9/3.10
    import tomli as tomllib

import numpy as np
import simpy

R_EARTH = 6371.0


def hav_km(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 2 * R_EARTH * math.asin(math.sqrt(h))


def load_params(path: str | pathlib.Path | None = None) -> dict:
    p = pathlib.Path(path or pathlib.Path(__file__).parent / "params.toml")
    with open(p, "rb") as f:
        return tomllib.load(f)


@dataclasses.dataclass
class Order:
    id: int
    rest: int
    cust: tuple[float, float]
    placed: float
    ready: float = math.nan
    assigned: float = math.nan
    picked: float = math.nan
    delivered: float = math.nan
    waves: int = 0
    cancelled: bool = False
    offered_to: set = dataclasses.field(default_factory=set)
    is_cash: bool = False
    value: float = 0.0


@dataclasses.dataclass
class Courier:
    id: int
    vehicle: str
    speed: float
    xy: tuple[float, float]
    busy: bool = False
    offline: bool = False
    consec_ignored: int = 0
    deliveries: int = 0
    busy_min: float = 0.0
    cash: float = 0.0          # ledger de numerar (courier_cash_movements)
    offloads: int = 0          # predări la sediu
    offload_min: float = 0.0   # timp mort cu predările


class Sim:
    def __init__(self, params: dict, seed: int, mode: str = "greedy",
                 radius_cap_km: float | None = None, delta_min: float = 0.0,
                 orders_per_day: int | None = None, fleet: dict | None = None,
                 restaurants: list | None = None, cash: dict | None = None):
        self.p = params
        self.rng = np.random.default_rng(seed)
        self.env = simpy.Environment()
        self.mode = mode
        self.cap = radius_cap_km
        self.delta = delta_min
        self.n_orders = orders_per_day or params["demand"]["orders_per_day"]
        self.rest = [tuple(c) for c in (restaurants or params["city"]["restaurants"])]
        # ---- modelul de NUMERAR (migrațiile 20260813000100/000400) ----
        # Oprit implicit: fără el, fluxul de numere aleatoare rămâne identic cu
        # rulările Faza 4, deci rezultatele vechi sunt încă reproductibile.
        self.cash_on = cash is not None
        if self.cash_on:
            self.cash_cap = cash["cap_mdl"]
            self.p_cash = cash["p_cash"]
            self.cod_cap = cash.get("cod_cap_mdl", 1400.0)
            self.offload_at = cash["offload_at_pct"] * self.cash_cap
            self.offload_fixed_min = cash["offload_minutes"]
            self.hq = tuple(cash["hq"])
            vmed, vp90 = cash["order_median_mdl"], cash["order_p90_mdl"]
            self.val_mu = math.log(vmed)
            self.val_sigma = (math.log(vp90) - math.log(vmed)) / 1.2816
        self.stat_cash_skips = 0      # curieri liberi săriți de gate-ul de numerar
        self.stat_cash_starved = 0    # comenzi rămase FĂRĂ candidat doar din cauza numerarului
        d = params["dispatch"]
        self.ttl, self.tick = d["offer_ttl_min"], d["sweeper_tick_min"]
        self.max_waves, self.ghost = d["max_waves"], d["ghost_streak"]
        self.handoff, self.dropoff = d["handoff_min"], d["dropoff_min"]
        self.cancel_after = d["cancel_after_ready_min"]
        self.p_accept, self.p_decline = d["p_accept"], d["p_decline"]
        speeds = params["speeds_kmh"]
        fleet = fleet or params["fleet"]
        self.couriers = []
        for vehicle, n in fleet.items():
            for _ in range(n):
                self.couriers.append(Courier(len(self.couriers), vehicle, speeds[vehicle], self._near_restaurant()))
        # lognormal potrivit pe mediană/p90 (z_0.9 = 1.2816)
        med, p90 = params["prep"]["median_minutes"], params["prep"]["p90_minutes"]
        self.prep_mu, self.prep_sigma = math.log(med), (math.log(p90) - math.log(med)) / 1.2816
        self.orders: list[Order] = []
        self.waiting: list[Order] = []  # gata, neasignate (re-încercate de sweeper)
        self.env.process(self._generate_orders())
        self.env.process(self._sweeper())

    # ---------- geometrie / util ----------
    def _near_restaurant(self) -> tuple[float, float]:
        base = self.rest[self.rng.integers(len(self.rest))]
        return self._offset(base)

    def _offset(self, base: tuple[float, float]) -> tuple[float, float]:
        sig = self.p["city"]["customer_sigma_km"]
        mx = self.p["city"]["customer_max_km"]
        dk = min(abs(self.rng.normal(0, sig)), mx)
        ang = self.rng.uniform(0, 2 * math.pi)
        return (base[0] + dk / 111.0 * math.cos(ang), base[1] + dk / 78.0 * math.sin(ang))

    def _eta_min(self, c: Courier, point: tuple[float, float]) -> float:
        return hav_km(c.xy, point) / c.speed * 60.0

    # ---------- generare comenzi ----------
    def _generate_orders(self):
        w = np.array(self.p["demand"]["hourly_weights"], dtype=float)
        w = w / w.sum()
        counts = self.rng.poisson(self.n_orders * w)
        times = sorted(t for h, n in enumerate(counts) for t in self.rng.uniform(h * 60, (h + 1) * 60, n))
        prev = 0.0
        for t in times:
            yield self.env.timeout(t - prev)
            prev = t
            rest_idx = int(self.rng.integers(len(self.rest)))
            o = Order(len(self.orders), rest_idx, self._offset(self.rest[rest_idx]), self.env.now)
            if self.cash_on:
                o.value = float(self.rng.lognormal(self.val_mu, self.val_sigma))
                # place_order respinge standard+cash peste plafonul COD → clientul
                # comută pe card (traducerea din CheckoutForm), nu pierdem comanda.
                o.is_cash = self.rng.random() < self.p_cash and o.value <= self.cod_cap
            self.orders.append(o)
            self.env.process(self._order_lifecycle(o))

    def _order_lifecycle(self, o: Order):
        pr = self.p["prep"]
        yield self.env.timeout(self.rng.uniform(pr["partner_accept_min"], pr["partner_accept_max"]))
        yield self.env.timeout(float(self.rng.lognormal(self.prep_mu, self.prep_sigma)))
        o.ready = self.env.now
        if self.delta > 0:
            yield self.env.timeout(self.delta)  # Q2: fereastra de acumulare Δ
        if self.mode == "greedy":
            self.env.process(self._dispatch_greedy(o))
        else:
            self.waiting.append(o)
        self.env.process(self._cancel_watch(o))

    def _cancel_watch(self, o: Order):
        yield self.env.timeout(self.cancel_after + self.delta)
        if math.isnan(o.assigned):
            o.cancelled = True
            if o in self.waiting:
                self.waiting.remove(o)

    # ---------- dispatch greedy (mecanica noastră) ----------
    def _candidates(self, o: Order):
        rest_xy = self.rest[o.rest]
        out = []
        cash_blocked = 0
        for c in self.couriers:
            if c.busy or c.offline or c.id in o.offered_to:
                continue
            # Gate-ul de numerar, fidel SQL: courier_has_capacity taie curierul
            # pentru ORICE comandă la balanță >= plafon; gate-ul din dispatch_order
            # taie doar comenzile cash care ar trece peste plafon (>= , nu >).
            if self.cash_on and (
                c.cash >= self.cash_cap or (o.is_cash and c.cash + o.value >= self.cash_cap)
            ):
                cash_blocked += 1
                continue
            dist = hav_km(c.xy, rest_xy)
            if self.cap is not None and dist > self.cap:
                continue
            out.append((dist / c.speed * 60.0, c))
        self.stat_cash_skips += cash_blocked
        if not out and cash_blocked:
            self.stat_cash_starved += 1
        return sorted(out, key=lambda x: x[0])

    def _dispatch_greedy(self, o: Order, waves_used: int = 0):
        while waves_used < self.max_waves:
            if not math.isnan(o.assigned) or o.cancelled:
                return
            cand = self._candidates(o)
            if not cand:
                break
            _, courier = cand[0]
            o.offered_to.add(courier.id)
            waves_used += 1
            o.waves += 1
            r = self.rng.random()
            if r < self.p_accept:
                courier.consec_ignored = 0
                self._assign(o, courier)
                return
            if r < self.p_accept + self.p_decline:
                continue  # refuz → cascadă imediată (nu atinge streak-ul)
            # ignorat → expiră la primul tick de sweeper după +TTL (30-45s real)
            expiry = self.ttl + (self.tick - (self.env.now + self.ttl) % self.tick)
            yield self.env.timeout(expiry)
            courier.consec_ignored += 1
            if courier.consec_ignored >= self.ghost:
                courier.offline = True  # ghost auto-offline (conservator: restul zilei)
        if math.isnan(o.assigned) and not o.cancelled and o not in self.waiting:
            self.waiting.append(o)  # sweeper-ul reia (rundă nouă de valuri)

    def _sweeper(self):
        while True:
            yield self.env.timeout(self.tick)
            if self.mode == "greedy":
                for o in list(self.waiting):
                    if math.isnan(o.assigned) and not o.cancelled and self._candidates(o):
                        self.waiting.remove(o)
                        o.offered_to.clear()
                        self.env.process(self._dispatch_greedy(o))
            else:
                self._match_global()

    # ---------- dispatch global (Q3: ungar pe matricea ETA) ----------
    def _match_global(self):
        from scipy.optimize import linear_sum_assignment
        waiting = [o for o in self.waiting if math.isnan(o.assigned) and not o.cancelled]
        idle = [c for c in self.couriers if not c.busy and not c.offline]
        if not waiting or not idle:
            return
        BIG = 1e6
        m = np.full((len(waiting), len(idle)), BIG)
        for i, o in enumerate(waiting):
            for j, c in enumerate(idle):
                dist = hav_km(c.xy, self.rest[o.rest])
                if self.cap is None or dist <= self.cap:
                    m[i, j] = dist / c.speed * 60.0
        rows, cols = linear_sum_assignment(m)
        for i, j in zip(rows, cols):
            if m[i, j] >= BIG:
                continue
            o, c = waiting[i], idle[j]
            o.waves += 1
            if self.rng.random() < self.p_accept:  # același model de acceptare
                self.waiting.remove(o)
                self._assign(o, c)

    # ---------- livrarea ----------
    def _assign(self, o: Order, c: Courier):
        o.assigned = self.env.now
        c.busy = True
        self.env.process(self._deliver(o, c))

    def _deliver(self, o: Order, c: Courier):
        t0 = self.env.now
        yield self.env.timeout(self._eta_min(c, self.rest[o.rest]))
        yield self.env.timeout(self.handoff)
        o.picked = self.env.now
        c.xy = self.rest[o.rest]
        yield self.env.timeout(self._eta_min(c, o.cust) + self.dropoff)
        o.delivered = self.env.now
        c.xy = o.cust
        c.deliveries += 1
        if self.cash_on and o.is_cash:
            c.cash += o.value
            # Predarea la sediu (cash_policy: „la sediul Dragon Courier, 09-21").
            # Curierul pleacă atunci când s-a apropiat de plafon — drumul e timp
            # mort: rămâne `busy`, deci nu primește oferte pe traseu.
            if c.cash >= self.offload_at:
                trip = self._eta_min(c, self.hq) + self.offload_fixed_min
                yield self.env.timeout(trip)
                c.xy = self.hq
                c.cash = 0.0
                c.offloads += 1
                c.offload_min += trip
        c.busy = False
        c.busy_min += self.env.now - t0

    # ---------- rulare + metrici ----------
    def run(self, horizon_min: float = 26 * 60) -> dict:
        self.env.run(until=horizon_min)
        done = [o for o in self.orders if not math.isnan(o.delivered)]
        eligible = [o for o in self.orders if not math.isnan(o.ready) and o.ready < 24 * 60]
        cancelled = [o for o in eligible if o.cancelled]

        def med_p90(xs):
            return (float(np.median(xs)), float(np.percentile(xs, 90))) if xs else (math.nan, math.nan)

        assign_m, assign_p90 = med_p90([o.assigned - o.ready - self.delta for o in done])
        total_m, total_p90 = med_p90([o.delivered - o.placed for o in done])
        online = [c for c in self.couriers if not c.offline]
        n_c = len(self.couriers)
        offload_total = sum(c.offload_min for c in self.couriers)
        # Ziua de lucru reală (09-23), nu 24h: utilizarea pe 24h e înșelător de mică.
        work_min = self.p["demand"].get("workday_minutes", 14 * 60)
        out = {
            "delivered": len(done),
            "eligible": len(eligible),
            "unassigned_pct": round(100 * len(cancelled) / max(1, len(eligible)), 2),
            "assign_med": round(assign_m, 2), "assign_p90": round(assign_p90, 2),
            "total_med": round(total_m, 2), "total_p90": round(total_p90, 2),
            "waves_avg": round(float(np.mean([o.waves for o in done])), 2) if done else math.nan,
            "ghosted": n_c - len(online),
            "deliveries_per_courier": round(len(done) / max(1, len(online)), 1),
            "utilization_pct": round(100 * sum(c.busy_min for c in self.couriers) / (n_c * work_min), 1),
        }
        if self.cash_on:
            out.update({
                "offloads_per_courier": round(sum(c.offloads for c in self.couriers) / n_c, 1),
                "offload_min_per_courier": round(offload_total / n_c, 1),
                "cash_skips": self.stat_cash_skips,
                "cash_starved_orders": self.stat_cash_starved,
                "cash_time_share_pct": round(100 * offload_total / max(1e-9, sum(c.busy_min for c in self.couriers)), 1),
            })
        return out


def run_reps(params: dict, reps: int = 5, base_seed: int = 42, **kw) -> dict:
    """Mediana pe replicări a fiecărei metrici (determinist: seed = base+rep)."""
    rows = [Sim(params, base_seed + r, **kw).run() for r in range(reps)]
    return {k: (round(float(np.median([row[k] for row in rows])), 2)
                if isinstance(rows[0][k], (int, float)) else rows[0][k]) for k in rows[0]}
