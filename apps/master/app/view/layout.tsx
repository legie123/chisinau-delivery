import { cookies } from "next/headers";
import { jsonForScript } from "@/lib/seo/safeJson";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { isViewerClient } from "@/lib/supabase/viewer";
import { VIEW_AS_COOKIE, readViewerToken } from "@/lib/viewAs/token";
import { ViewAsChrome } from "./ViewAsChrome";

// View-as ("vezi ca"): every page under /view is a monolith page re-exported as-is, rendered for
// the viewed user through the read-only viewer client. The proxy already gates /view (valid token,
// minted for the signed-in admin); this layout re-checks and fails CLOSED if the page would not
// run on the viewer client — e.g. the turbopack alias stopped applying and createClient() is the
// admin's own session again.
export const dynamic = "force-dynamic";

export default async function ViewLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(VIEW_AS_COOKIE)?.value;
  const claims = readViewerToken(token);
  if (!token || !claims) redirect("/platform/view-as?e=expirat");

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!isViewerClient(supabase) || user?.id !== claims.sub) {
    throw new Error("Mod vizualizare indisponibil: pagina nu rulează pe clientul de citire.");
  }
  const { data: profile } = await supabase.from("profiles").select("full_name").eq("id", claims.sub).maybeSingle();

  return (
    <>
      {/* The browser client of this shell (apps/master/lib/viewAs/browserClient.ts) reads the token
          from window. Set while the HTML is parsed — before any child component hydrates and opens
          a client in an effect. The token is read-only by the DB and refused by GoTrue; the cookie
          copy stays httpOnly for the server. */}
      <script dangerouslySetInnerHTML={{ __html: `window.__VIEW_AS_TOKEN__=${jsonForScript(token)};` }} />
      <ViewAsChrome
        token={token}
        app={claims.view_as_app}
        name={profile?.full_name ?? "utilizator"}
        expiresAt={claims.exp}
        session={claims.view_as_session}
      >
        {children}
      </ViewAsChrome>
    </>
  );
}
