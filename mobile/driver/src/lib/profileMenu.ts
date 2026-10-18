// Profile menu actions, separated from the screen so each one is tested for what it DOES.
export type MenuAction = "payout" | "support" | "signout";

export function runMenuAction(
  action: MenuAction,
  deps: { togglePayout: () => void; callSupport: (() => void) | null; signOut: () => void },
): void {
  switch (action) {
    case "payout":
      deps.togglePayout();
      return;
    case "support":
      deps.callSupport?.();
      return;
    case "signout":
      deps.signOut();
      return;
  }
}

// "Accept comenzi cu numerar": the switch shows the SERVER's value (couriers.accepts_cash) and moves only
// when set_courier_accepts_cash succeeds; a refusal (e.g. during a delivery) keeps it and says why.
export async function changeAcceptsCash(
  next: boolean,
  deps: { save: (accepts: boolean) => Promise<string | null>; apply: (accepts: boolean) => void; fail: (message: string) => void },
): Promise<void> {
  const error = await deps.save(next);
  if (error) deps.fail(error);
  else deps.apply(next);
}

export function cashPreferenceHint(accepts: boolean): string {
  return accepts
    ? "Primești și comenzi plătite cu numerar."
    : "Nu primești comenzi cu numerar. Comenzile plătite cu cardul îți sunt oferite în continuare.";
}
