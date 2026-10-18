import { describe, expect, it, vi } from "vitest";

// /profile is not in proxy.ts's guarded list, so the page itself must behave like its guarded
// sisters (/deliveries, /earnings): no session -> /login?next=/profile; a session that is not a
// courier (customer, admin) -> bounce to /. Before the guard the page rendered the courier shell
// with a false "Contul tău nu este înregistrat ca curier" for a person who was simply logged out.

const state: { user: { id: string } | null; courier: { id: string } | null } = { user: null, courier: null };

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user } }) },
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        maybeSingle: async () => ({ data: state.courier }),
      };
      return q;
    },
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT ${to}`);
  },
}));

const render = async () => {
  const { default: Page } = await import("../../src/app/(courier)/profile/page");
  return Page();
};

describe("courier web /profile guard", () => {
  it("logged out -> /login?next=/profile, not a 'not registered' page", async () => {
    state.user = null;
    state.courier = null;
    await expect(render()).rejects.toThrow("REDIRECT /login?next=/profile");
  });
  it("logged in without a courier row (customer/admin) -> bounce to /", async () => {
    state.user = { id: "u-client" };
    state.courier = null;
    await expect(render()).rejects.toThrow("REDIRECT /");
  });
  it("a courier gets the page", async () => {
    state.user = { id: "u-courier" };
    state.courier = { id: "c1" };
    await expect(render()).resolves.toBeTruthy();
  });
});
