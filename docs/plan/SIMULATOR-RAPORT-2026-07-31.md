# Simulator Faza 4 — Raport (2026-07-31)

Simulator SimPy DES fidel mecanicii reale (vezi `tools/simulator/README.md`).
**Validare structurală 5/5 PASS**: determinism (același seed → ieșire identică),
teste de semn (2×flotă ⇒ asignare mai rapidă; flotă doar-biciclete ⇒ +7,8 min
total; 5×cerere ⇒ nu mai bine), ancoră de sanitate: **total median 50,1 min** —
lângă media Straus (~49 min), peste ținta Wolt (~35 min) din cauza prep-ului seed
de 33/46 min. Fiecare cifră de mai jos există în `tools/simulator/runs/*.csv`.
Scenariu pilot de bază: 40 comenzi/zi, flota reală din seed (10 curieri), 5 replicări.

## Q1 — Raza maximă de ofertă: **fără plafon strâns; 6 km e sigur**
| Plafon | Total med | P90 | Neasignate |
|---|---|---|---|
| 2 km | 49,3 | 63,9 | **28,9%** ❌ |
| 3 km | 48,2 | 65,5 | **15,8%** ❌ |
| 4 km | 50,3 | 65,0 | 6,8% ⚠️ |
| **6 km** | 50,1 | 63,0 | **0%** ✅ |
| ∞ | 49,1 | 61,5 | 0% |
Un plafon sub 4 km abandonează comenzi fără să câștige timp — la 10 curieri pe
~8×8 km, curierul „departe" e adesea singurul liber. Defaultul actual din SQL
(6 km fallback) este exact zona corectă. **Acțiune: nu implementăm radius-cap.**

## Q2 — Fereastra de acumulare Δ: **Δ=0, orice așteptare doar costă**
| Δ | Total med |
|---|---|
| 0 | **49,1** ✅ |
| 30s | 51,0 |
| 1 min | 51,9 |
| 2 min | 51,1 |
| 3 min (FOODMATCH default) | 54,6 ❌ |
La densitatea noastră, acumularea înainte de prima ofertă nu îmbunătățește
potrivirea (flota e liberă oricum) — adaugă latență pură: +5,5 min la Δ=3 min.
Confirmă cu datele noastre teza auditului: câștigul batching-ului e efect de
congestie, inexistent sub ~100k comenzi/zi. **Acțiune: dispatch imediat, ca acum.**

## Q3 — Greedy-cascade vs matching global (ungar): **greedy ține până la saturație**
Câștigul global vs greedy pe totalul median:
| Comenzi/zi | 10 curieri | 20 curieri |
|---|---|---|
| 30 | +1,0% | +2,7% |
| 60 | +3,3% | +1,2% |
| 120 | +0,4% | −0,5% |
| 240 | +3,3% | +2,9% |
| **480** | **+27,2% ← TRIGGER** | +3,7% |
Singura celulă peste pragul de 10% (Faza 6) e **480 comenzi/zi pe 10 curieri** =
~48 livrări/curier/zi, utilizare >50%, 27% comenzi abandonate în greedy (78,5 →
57,2 min cu global; și un curier ajunge ghost-offline sub presiune). Cu 20 de
curieri, aceeași cerere revine la +3,7%.
**Pragul măsurat pe parametrii NOȘTRI: matching-ul global devine justificat abia
când flota e înecată — ≳24 livrări/curier/zi susținut. Regula operațională e
inversă: la acel semnal ADAUGI curieri (cohortele din verdictul GO-IF), nu
rescrii dispatch-ul.** Trigger-ul Faza 6 rămâne armat pe: câștig simulat >10%
la densitatea măsurată în pilot.

## Limite declarate
Model de acceptare 75/15/10 = ipoteză; prep din seed (33/46 min) — de recalibrat
cu `restaurant_prep_stats` real după pilot; fără reacția umană la accept (~10–25s);
ghost = restul zilei. Ținta (per audit + precedent Glovo/DoorDash): **acuratețe
direcțională**, nu precizie absolută. Re-rulare: `experiments.py all`.

Legături: [[Chisinau Delivery - CORE Platforma Curieri]] · audit §8 Faza 4/6.
