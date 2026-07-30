# Simulator Dragon Courier (Faza 4)

Simulator discret pe evenimente (**SimPy** — stack-ul folosit chiar de Glovo) al
mecanicii reale de dispatch din repo: ofertă push 30s → un singur curier, sweeper
15s (expirare efectivă 30–45s), refuz → cascadă imediată, max 5 valuri per rundă
apoi re-încercare, scor = **doar ETA** (post-anonimitate, fără termen de
acceptare), capacitate 1 livrare, ghost auto-offline la 3 expirări consecutive.
Modul `global` schimbă DOAR asignarea: potrivire ungară (scipy) pe matricea ETA
la fiecare tick — exact întrebarea „greedy vs global" din audit.

## Rulare
```bash
cd tools/simulator
python3 -m venv .venv && .venv/bin/pip install simpy numpy scipy tomli
.venv/bin/python experiments.py all     # validate + q1 + q2 + q3 → runs/*.csv
```

## Ce răspunde
- **Q1** raza maximă de ofertă · **Q2** fereastra de acumulare Δ · **Q3**
  crossover-ul greedy↔global pe densități — vezi
  `docs/plan/SIMULATOR-RAPORT-2026-07-31.md` pentru răspunsuri + praguri Faza 6.

## Onestitate (limitele modelului)
- Parametrii `[DB]` din `params.toml` sunt reali (coordonate restaurante, flotă,
  prep 33/46 min); modelul de acceptare (75/15/10) și ofsetul clienților sunt
  **ipoteze declarate** — se calibrează cu datele pilotului (audit: ținta e
  acuratețe DIRECȚIONALĂ, nu precizie).
- Reacția umană la accept (~10–25s) nu e modelată → `assign_med≈0` la flotă
  liberă înseamnă „cascada nu adaugă latență", nu „asignare instantanee".
- Ghost-offline = restul zilei (conservator). Fără batching multi-comandă (NU-list).
- Determinist: același seed → ieșire identică (verificat în `validate`).
