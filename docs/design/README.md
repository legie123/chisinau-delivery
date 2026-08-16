# Design DNA

`dragons-dna.json` is the Dragons Alliance Premium design system, extracted
from the real repo (`globals.css`, `premium.css`, customer/admin components)
plus the documented monogram palette — navy, brushed gold, amethyst crystal,
red CTA, Playfair Display serif.

Schema: three dimensions — `design_system` (tokens), `design_style`
(qualitative feel), `visual_effects` (CSS/SVG/WAAPI only; no WebGL/3D/particles
here — those live in the separate godmode lab).

**Rule: orice builder de UI citește `dragons-dna.json` înainte să scrie
stiluri.** New surfaces should pull toward the "premium" register (pg-*
utilities) documented inside, not invent new tokens.

## Marca — `public/brand/dragons-crest.svg` (V4, 2026-08-16)

Până la V4 marca era emoji-ul 🐉, pus direct în 15 locuri. Un emoji nu e un
logo: îl desenează fontul sistemului, deci pe iPhone era dragonul verde-lucios
al Apple, pe Android altul. Verdele nu există în paletă — marca se certa cu
propriul wordmark auriu de sub ea, pe fiecare ecran.

Generată cu `higgsfield-brandkit` (Recraft V4.1, `model_type=vector`), din
paleta și tipografia de mai sus, blocate ca **autoritative** — brandkit-ul a
completat DOAR slotul lipsă (marca), n-a redesenat nimic existent.

- job `c9ad2096-18b4-4a7e-864b-b51a9f52d6c0` · fingerprint
  `14c525356fbcf7cf82adce654d7ebe44229a4f905437a297329faf251a5d6b24`
- 3 candidați generați, ales #3 (ouroboros — dragonul își ia coada, corpul lui
  *e* conturul, fără ramă separată). #1 (spirală monoline) devenea o pată sub
  40px; #2 (cap fațetat) scala cel mai bine dar citea „săgeată de trimitere",
  nu dragon, și a venit off-paletă (`#FBF619`).
- Din fișierul generat s-a scos EXACT o cale: pânza `M 0 0 L 2048 0 L 2048 2048`.
  **Nu scoate celelalte căi navy** — golul din mijlocul inelului e o cale navy
  pictată peste discul auriu, nu fundal; scoase toate, marca devine un disc
  auriu plin. Probat prin randare, nu prin citit.
- Podea de lizibilitate măsurată: **~48px**. La 60px capul se citește clar; la
  36px rămâne un inel auriu — ornament, nu creatură. Vezi `.bucla/issues.md`.
- Consumatori: `src/components/brand/BrandMark.tsx` (`BrandMark` sm/md/lg +
  `BrandWatermark`). Nu insera SVG-ul inline — e servit o dată ca fișier static.
