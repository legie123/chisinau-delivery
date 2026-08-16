import { describe, expect, it } from "vitest";
import { restaurantPresence } from "@/lib/orders/presence";

// Valul adversarial (V11) a găsit trei etichete care descriau greșit ce e
// dedesubt, toate pe suprafața partenerului. Asta e garda pentru cea mai
// scumpă dintre ele: pastila de stare din antet, care scria „Live" indiferent
// de realitate. Probele de mai jos sunt exact stările găsite în DB-ul viu la
// 2026-08-16, nu cazuri inventate.

describe("restaurantPresence", () => {
  it("nu spune că primește comenzi când e în afara programului", () => {
    // Cazul VIU: Sakura Sushi, program 00:00–02:00, ora 07:22 — restaurant_open_at()
    // întorcea `false`, iar antetul scria „LIVE".
    const p = restaurantPresence({ isActive: true, acceptingOrders: true, openNow: false });
    expect(p.live).toBe(false);
    expect(p.state).toBe("closed");
    expect(p.label).toBe("Închis acum");
  });

  it("spune când se redeschide, dacă ora e cunoscută", () => {
    const p = restaurantPresence({
      isActive: true,
      acceptingOrders: true,
      openNow: false,
      nextOpening: "mâine la 00:00",
    });
    expect(p.detail).toBe("deschide mâine la 00:00");
  });

  it("nu inventează o oră de deschidere când nu există niciuna", () => {
    const p = restaurantPresence({ isActive: true, acceptingOrders: true, openNow: false, nextOpening: null });
    expect(p.detail).toBeNull();
  });

  it("anunță pauza proprie a partenerului chiar dacă e în program", () => {
    // Cazul VIU: Zen Spa / Aura Wellness / Nexus Business au accepting_orders=false.
    const p = restaurantPresence({ isActive: true, acceptingOrders: false, openNow: true });
    expect(p.live).toBe(false);
    expect(p.state).toBe("paused");
    expect(p.label).toBe("Comenzi oprite");
  });

  it("pune neactivarea înaintea oricărei alte stări", () => {
    // Un cont neactivat nu apare la clienți — orarul lui nu are ce promite.
    const p = restaurantPresence({ isActive: false, acceptingOrders: true, openNow: true });
    expect(p.state).toBe("inactive");
    expect(p.live).toBe(false);
  });

  it("pauza bate orarul în ordinea de anunțare", () => {
    const p = restaurantPresence({ isActive: true, acceptingOrders: false, openNow: false });
    expect(p.state).toBe("paused");
  });

  it("declară `live` DOAR când toate trei condițiile țin", () => {
    const p = restaurantPresence({ isActive: true, acceptingOrders: true, openNow: true });
    expect(p.live).toBe(true);
    expect(p.label).toBe("Primește comenzi");
    expect(p.detail).toBeNull();
  });

  it("nicio combinație blocantă nu se raportează ca live", () => {
    const combos = [
      { isActive: false, acceptingOrders: false, openNow: false },
      { isActive: false, acceptingOrders: false, openNow: true },
      { isActive: false, acceptingOrders: true, openNow: false },
      { isActive: true, acceptingOrders: false, openNow: false },
      { isActive: true, acceptingOrders: false, openNow: true },
      { isActive: true, acceptingOrders: true, openNow: false },
    ];
    for (const c of combos) expect(restaurantPresence(c).live).toBe(false);
  });
});
