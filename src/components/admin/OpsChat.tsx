"use client";

import { useEffect, useRef, useState } from "react";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "Care e starea platformei chiar acum?",
  "Ce comenzi sunt blocate și ce fac cu ele?",
  "Cum a mers săptămâna — livrări și revenue?",
  "Cui datorăm bani (payouts neacoperite)?",
  "Explică-mi cum funcționează dispatch-ul și plafonul de numerar.",
];

// Chat-ul operațional: streaming pe fetch-reader, istoric în memorie (nu
// persistăm conversații — contextul viu se reconstruiește oricum la fiecare
// întrebare, server-side). Enter trimite, Shift+Enter face rând nou.
export function OpsChat() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(question: string) {
    const q = question.trim();
    if (!q || busy) return;
    setError(null);
    setInput("");
    const history: Msg[] = [...messages, { role: "user", content: q }];
    setMessages([...history, { role: "assistant", content: "" }]);
    setBusy(true);
    try {
      const res = await fetch("/api/platform/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: history }),
      });
      if (!res.ok || !res.body) {
        throw new Error((await res.text().catch(() => "")) || `HTTP ${res.status}`);
      }
      setProvider(res.headers.get("x-ai-provider"));
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        const snapshot = acc;
        setMessages([...history, { role: "assistant", content: snapshot }]);
      }
      if (!acc) throw new Error("răspuns gol de la model");
    } catch (err) {
      setMessages(history);
      setError(err instanceof Error ? err.message : "Eroare necunoscută.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-6 text-center">
            <p className="max-w-md text-sm leading-relaxed text-white/45">
              Întreabă orice despre platformă — comenzi, curieri, bani, reguli.
              Răspund pe <span className="text-gold/80">starea vie de acum</span>, nu pe rapoarte vechi.
            </p>
            <div className="flex max-w-xl flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full bg-white/[0.04] px-4 py-2 text-xs text-white/70 ring-1 ring-white/10 transition hover:bg-gold/10 hover:text-gold hover:ring-gold/40"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] rounded-2xl rounded-br-md bg-gold/15 px-4 py-2.5 text-sm text-gold-light ring-1 ring-gold/25"
                  : "max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-bl-md bg-white/[0.05] px-4 py-2.5 text-sm leading-relaxed text-white/85 ring-1 ring-white/[0.08]"
              }
            >
              {m.content || (busy && i === messages.length - 1 ? "…" : "")}
            </div>
          </div>
        ))}
        {error && (
          <p className="rounded-xl bg-primary/10 px-4 py-2.5 text-sm text-primary ring-1 ring-primary/25">{error}</p>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-4 flex items-end gap-2"
      >
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send(input);
            }
          }}
          rows={2}
          placeholder="Întreabă despre platformă…"
          className="min-h-[52px] flex-1 resize-none rounded-2xl bg-white/[0.05] px-4 py-3 text-sm text-white placeholder-white/30 ring-1 ring-white/10 outline-none transition focus:ring-gold/50"
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          className="rounded-full bg-gold px-6 py-3 text-sm font-bold text-zinc-900 transition hover:bg-gold-light disabled:cursor-not-allowed disabled:opacity-40"
        >
          {busy ? "Gândește…" : "Trimite"}
        </button>
      </form>
      {provider && (
        <p className="mt-2 text-right text-[10px] uppercase tracking-wider text-white/25">
          motor: {provider === "anthropic" ? "Claude" : "model local"}
        </p>
      )}
    </div>
  );
}
