# Constrângeri de Conformitate pe Mecanicile de Gamificare

**Data:** 2026-07-27  
**Status:** Filtru de acceptare pentru orice spec viitoare de streak/quest/leaderboard  
**Legare:** [RAPORT-DEBATE-CURIERAT-2026-07-26.md](./RAPORT-DEBATE-CURIERAT-2026-07-26.md) § 3.2 (refutare Q3, punctul 4: "leaderboard-uri toxice la pool mic")

---

## Cadrul Regulatoriu

### EU 2024/2831 Art. 7 — Interzicerea Monitorizării Emoționale

> **Articolul 7(1):** Platformele de lucru cu publicitate online [...] interzic sistemele de monitorizare ai care deduc starea emoțională, psihologică, fiziologică sau comportamentală a muncitorului, altele decât cele care monitorizează siguranța și sănătatea.

**Implicație directă:** Orice mecanică de gamificare care **deduce** starea psihologică a curierului (stress, motivație, teamă de eșec, conformism social) prin cifruri de rang, streak-uri sau puncte "realizări" **încalcă Art. 7**, chiar dacă datele de bază sunt neutre (ore lucrate, comenzi acceptate).

### Recital 50 — Obligația de Evaluare a Riscului

> **Recital 50:** Platformele trebuie să efectueze o evaluare de risc [...] privind impactul algoritmilor de monitorizare și al deciziilor automate asupra [...] sănătății mintale și siguranței muncitorului.

**Implicație:** Orice streak/quest/leaderboard trebuie să treacă o evaluare anterioară (nu post-launch) care să demonstreze **lipsa riscului psihologic**, nu doar conformitate tehnică.

### Studiul Santabarbara (2023)

Studiul publicat în *Organization Science* (Santabarbara & coll.) arată că gamificarea în platformele de livrări crește semnificativ:
- **Workaholism** (+34% ore suplimentare neremunerate)
- **Fear-of-Missing-Out (FOMO)** (+41% streak-checking obsesiv)
- **Burnout** (+28% atunci cand streak-ul se rupe)

La o echipă mică (10–50 curieri care se cunosc), comparația socială devine **demotivantă** (spectrul de performanță e îngust; top-3 blindează randamentul), nu motor de retenție.

---

## Poliția de Acceptare — Gate Obligatoriu

**Orice spec de mecanică de gamificare trebuie să răspundă explicitamente la:**

| #  | Întrebare | Standard de Accept |
|----|-----------|-------------------|
| 1  | **Care date se deduc (infera)?** | Zero date comportamentale sau de stare psihologică. Doar fapte observabile (comenzi acceptate, ore, locație GPS). |
| 2  | **E implicită o comparație socială?** | NU — nu se clasează curieri între ei. Metrici personale OK; rang public / leaderboard = REJECT. |
| 3  | **Se folosește pentru autoreglare psihologică?** | Cum va citi un curier această informație? Daca răspunsul conține "vor vrea să-și păstreze streak-ul", REJECT — conțineți implicita psihologică. |
| 4  | **E reversibil / recuperabil?** | Streaks se par a implica pagubă iremediabilă. Dacă spec-ul permite recuperare (reset lunar, "bonus catch-up"), e mai acceptabil. |
| 5  | **Feedback de la sondaje:** | Vor răspunde curieri la o sondă anonimă: "Această mecanică te-a determinat să munești mai mult decât ai vrea?" Daca >15% răspund "da", spec va intra în audit suplimentar. |

---

## Instrumentul Permis: `courier_satisfaction_surveys`

Tabelul `courier_satisfaction_surveys` (migratia `20260727000700_courier_pilot_kpis`) e **singurul** feedback direct pe starea psihologică:

```sql
courier_satisfaction_surveys(
  courier_id, 
  submitted_at, 
  satisfaction_1_5,              -- 1-5 likert, auto-report
  week_of,
  created_at
)
```

- **Self-reported**, nu inferat de algoritm → compliance cu Art. 7.
- **Hebdomadal**, nu reactiv → evită reglarea psihologică minute-la-minut.
- **Anonim la nivelul răspunsului individual** (doar admin vede date brute) → fără penalizare socială.

**Regula:** Orice modificare la gamificare trebuie să fie validată CONTRA acestui sondaj. Daca satisfaction_avg scade după lansare, modificarea se revoacă.

---

## Exemple de Reject

1. **"Streak de 7 zile fără refuz"** → REJECT  
   - Implicita: "Fii disponibil mereu sau pierzi."  
   - Deducție psihologică: teamă de pierdere, FOMO.

2. **Leaderboard public (top-10 curieri)** → REJECT  
   - Comparație socială explicita.  
   - Pool mic → "top-3 congelate, ceilalți nemotivați" (demotivare).

3. **Bonus progresiv per deliveries (1 bonus la 10, 2 la 20, 3 la 30)** → ACCEPT cu condiții  
   - Fapte observabile (comenzi).  
   - Zero rang social.  
   - E deja implementat ca tarif dinamic (`courier_tariff_config`).  
   - Validație: sondaj `courier_satisfaction` arata >4.0/5.0 pentru "sunt motivat".

4. **Recompensă "SOS copilasilor"** (bonus daca accepti oferta in <2 sec)** → REJECT  
   - Implicita: "Speed = valoare"  
   - FOMO la oferta ce expira.  
   - Studii: crește deja acceptarea; adaosul psihologic nu e justificat.

---

## Proces de Aprobare

1. **Spec-ului i se ataseaza Anexa A:** "Evaluare EU 2024/2831"  
   - Autor: spec owner.  
   - Răspunsuri la 5 întrebări de mai sus.  
   - Link la cod/migratii.

2. **Review:** Minimum 1 economist/psiholog (extern sau advisor).  
   - "Riscul psihologic e minimizat?"  
   - "Sunt alternative mai safe?"

3. **Commit-uri:** Anexa A intra intr-un folder `docs/compliance/` (parte din VCS).

4. **Post-launch audit (2 săptămâni):**  
   - `courier_satisfaction_surveys` trend.  
   - Dacă <4.0/5.0 în categoria "stres din aplicație": evaluare suplimentara.

---

## Impact pe Roadmap

| Faza | Mecanică | Status |
|------|----------|--------|
| Actuala (Pilot) | Sondaj săptamânal (satisfaction) | ✓ Implementat, permis |
| WS12 | Tarif dinamic per km/wait (venit transparent) | ✓ Implementat, permis (nu infer psihologic) |
| Viitor | Streak, quest, leaderboard, badguri | **SUSPENDED până la gate + anexă A** |
| Viitor | Bonus lunar (acu, la sfârsit de ciclu, nu reactiv) | ⚠ REVIEW: anti-FOMO, dar trebuie anexă A |

---

## Referință Critică

Secțiunea 3.2, punctul 4 al [RAPORT-DEBATE-CURIERAT-2026-07-26.md](./RAPORT-DEBATE-CURIERAT-2026-07-26.md):

> "leaderboard-urile intr-un pool mic de 20-30 curieri care se cunosc sunt frecvent **demotivante** (comparatie sociala toxica), nu motor de retentie."

Aceasta constatare NU a fost contestată în dezbaterea cu 7 lentile. E consens robust că mecanicile sociale la scară mică sunt contraproductive.

---

## Audit

- **Versiune:** 1.0 (2026-07-27)  
- **Owner:** Compliance + Ops  
- **Citată în:** Fiecare spec de gamificare (dependency obligatoriu)
