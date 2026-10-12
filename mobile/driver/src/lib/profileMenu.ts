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
