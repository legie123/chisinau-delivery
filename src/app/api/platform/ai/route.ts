import { createClient } from "@/lib/supabase/server";
import { gatherOpsContext } from "@/lib/ai/context";
import { streamChat, activeProvider, type ChatMessage } from "@/lib/ai/provider";

// Chat-ul operațional al platformei. Gate-ul de AICI e SINGURA barieră —
// proxy.ts nu acoperă /api/* (armata 2026-08-14): contextul conține agregate
// cross-platformă, deci gate-ul e fail-closed pe profil. Contextul viu se
// reconstruiește LA FIECARE întrebare — asistentul răspunde mereu pe starea
// de acum, nu pe un snapshot vechi din istoric.

const MAX_MESSAGES = 30;
const MAX_CONTENT = 4000;

const SYSTEM_PREAMBLE = `Ești asistentul operațional al platformei Dragons Delivery
(Chișinău). Vorbești română, concis și concret — cifre exacte din context, nu
estimări inventate. Dacă întrebarea cere date pe care nu le ai în context, spui
exact ce lipsește și în ce secțiune din panou se găsește. Nu inventezi niciodată
comenzi, sume sau nume. Pentru acțiuni (anulare, payout, suspendare) explici
pașii în panou — tu nu execuți nimic. Răspunzi în TEXT SIMPLU, fără Markdown
(fără **, ###, tabele) — interfața afișează text brut; liste cu liniuță simplă.`;

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("Neautentificat.", { status: 401 });

  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  if (profile?.role !== "platform_admin") return new Response("Doar pentru administratorul platformei.", { status: 403 });

  let body: { messages?: unknown };
  try {
    body = await req.json();
  } catch {
    return new Response("Body invalid.", { status: 400 });
  }

  const raw = Array.isArray(body.messages) ? body.messages : [];
  const messages: ChatMessage[] = raw
    .filter(
      (m): m is ChatMessage =>
        typeof m === "object" &&
        m !== null &&
        ((m as ChatMessage).role === "user" || (m as ChatMessage).role === "assistant") &&
        typeof (m as ChatMessage).content === "string",
    )
    .slice(-MAX_MESSAGES)
    .map((m) => ({ role: m.role, content: m.content.slice(0, MAX_CONTENT) }));

  if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
    return new Response("Lipsește întrebarea.", { status: 400 });
  }

  try {
    const context = await gatherOpsContext();
    const stream = await streamChat(`${SYSTEM_PREAMBLE}\n\n${context}`, messages);
    return new Response(stream, {
      headers: {
        "content-type": "text/plain; charset=utf-8",
        "cache-control": "no-store",
        "x-ai-provider": activeProvider(),
      },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "eroare necunoscută";
    // 502: providerul (Anthropic/Ollama) e jos — clientul afișează mesajul curat.
    return new Response(`Asistentul nu poate răspunde acum (${msg}).`, { status: 502 });
  }
}
