"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toViewPath } from "@/lib/viewAs/paths";
import type { ViewAsApp } from "@/lib/viewAs/token";

const APP_LABEL: Record<ViewAsApp, string> = { client: "client", curier: "curier", restaurant: "partener restaurant" };

function mmss(seconds: number) {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/**
 * Banner + guards around a view-as page:
 *  - keeps navigation inside the view: a click on a monolith link ("/orders/1") becomes
 *    "/view/orders/1", or is stopped when the view does not show that page;
 *  - fails closed: if the browser createClient() is not the viewer client, the page is covered.
 * Exit = end_view_as (audited) + cookie cleared; expiry = the JWT's exp (the DB refuses it).
 */
export function ViewAsChrome({
  token,
  app,
  name,
  expiresAt,
  session,
  children,
}: {
  token: string;
  app: ViewAsApp;
  name: string;
  expiresAt: number;
  session: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [left, setLeft] = useState(() => expiresAt - Math.floor(Date.now() / 1000));
  const [notice, setNotice] = useState<string | null>(null);
  const [unsafe, setUnsafe] = useState(false);

  useEffect(() => {
    const t = setInterval(() => setLeft(expiresAt - Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);

  useEffect(() => {
    if (left <= 0) window.location.assign("/platform/view-as?e=expirat");
  }, [left]);

  // The layout's inline script set it at parse time, before any child effect; this only covers a
  // client-side navigation INTO /view (no script runs then).
  useEffect(() => {
    window.__VIEW_AS_TOKEN__ = token;
  }, [token]);

  useEffect(() => {
    Promise.all([import("@/lib/supabase/client"), import("@/lib/supabase/viewer")])
      .then(([client, viewer]) => setUnsafe(!viewer.isViewerClient(client.createClient())))
      .catch(() => setUnsafe(true));
  }, []);

  function keepInsideView(event: React.MouseEvent) {
    const anchor = (event.target as HTMLElement).closest("a[href]") as HTMLAnchorElement | null;
    if (!anchor || anchor.target === "_blank" || event.defaultPrevented) return;
    const url = new URL(anchor.href, window.location.href);
    if (url.origin !== window.location.origin || url.pathname === "/view" || url.pathname.startsWith("/view/")) return;
    event.preventDefault();
    event.stopPropagation();
    const to = toViewPath(app, url.pathname);
    if (to) router.push(to + url.search + url.hash);
    else setNotice("Pagina asta nu face parte din vizualizare.");
  }

  const exit = (
    <form method="POST" action="/master/view-as/end">
      <input type="hidden" name="session" value={session} />
      <button
        type="submit"
        className="rounded-full bg-black/30 px-3 py-1 text-xs font-semibold text-white ring-1 ring-white/30 transition hover:bg-black/50"
      >
        Ieși din vizualizare
      </button>
    </form>
  );

  return (
    <>
      <div
        role="status"
        className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-gradient-to-r from-amber-500 to-red-600 px-4 py-2 text-sm text-white sm:px-6"
      >
        <span className="font-bold uppercase tracking-wider">Vezi ca</span>
        <span className="min-w-0 truncate">
          {name} <span className="text-white/80">({APP_LABEL[app]})</span>
        </span>
        <span className="rounded-full bg-black/25 px-2 py-0.5 text-xs font-semibold">doar citire</span>
        <span className="text-xs text-white/85" aria-live="off" suppressHydrationWarning>
          expiră în {mmss(left)}
        </span>
        {notice && <span className="text-xs font-semibold">{notice}</span>}
        <span className="ml-auto">{exit}</span>
      </div>
      <div onClickCapture={keepInsideView} className="flex flex-1 flex-col">
        {children}
      </div>
      <div
        className="pointer-events-none fixed bottom-3 left-3 z-[60] rounded-full bg-red-600/90 px-3 py-1 text-xs font-semibold text-white shadow-lg"
        suppressHydrationWarning
      >
        Vezi ca · doar citire · {mmss(left)}
      </div>
      {unsafe && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-black/90 p-6 text-center text-white">
          <p className="max-w-md text-lg font-semibold">
            Mod vizualizare indisponibil: clientul din browser nu e cel de citire, deci pagina e blocată.
          </p>
          {exit}
        </div>
      )}
    </>
  );
}
