# Decizii arhitecturale (jurnal)

- 2026-07-13: Backend = Supabase proiect partajat rdowjxnuyawhrjppxzuu (alegerea userului, gratuit vs $10/lună). NU se ating tabelele Trade-AI.
- 2026-07-13: Toate tranzițiile de status = RPC-uri security-definer cu dublă verificare (tranziție+autor). Fără .update() client pe orders/catering_details.
- 2026-07-15: Proxy pe TOATE rutele non-statice (rotația token-urilor se pierdea pe rutele client → logout forțat).
- 2026-07-16: Design system = Bolt-derived dark + Dragons Alliance Premium (serif gold, tinturi per bucătărie). Sursa: mockup + video referință user.
- 2026-07-16: Hub 3 sectoare + /enter/[role] doorway demo FĂRĂ parolă (cerință user). DE ȘTERS înainte de lansare publică.
- 2026-07-16: window.confirm/prompt interzise (PWA instalat = no-op silențios) → UI inline.
- AUTORIZARE COMMIT: userul a stabilit explicit pattern-ul "commit atomic per val/iterație" în acest repo (LOOP RULE în CLAUDE.md proiect) — valabil ca instrucțiune permanentă aici. Push/deploy rămân interzise fără OK explicit.
