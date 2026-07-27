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
