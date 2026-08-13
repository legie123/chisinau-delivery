// Lanțul de provideri pentru chat-ul operațional: Anthropic (dacă există
// ANTHROPIC_API_KEY în mediu) → Ollama local (gemma4). Fără SDK-uri — fetch
// direct + parsare de stream, ca să nu adăugăm dependențe. Ambele ramuri
// întorc același contract: ReadableStream<Uint8Array> cu TEXT brut (deltele),
// pe care ruta îl trece direct clientului.

export type ChatMessage = { role: "user" | "assistant"; content: string };

const ANTHROPIC_MODEL = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-5";
const OLLAMA_URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gemma4:latest";

export function activeProvider(): "anthropic" | "ollama" {
  return process.env.ANTHROPIC_API_KEY ? "anthropic" : "ollama";
}

export async function streamChat(system: string, messages: ChatMessage[]): Promise<ReadableStream<Uint8Array>> {
  return activeProvider() === "anthropic" ? streamAnthropic(system, messages) : streamOllama(system, messages);
}

// Transformă un body-stream linie-cu-linie (SSE sau NDJSON) în text-delta.
function lineTransform(extract: (line: string) => string | null): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = "";
  return new TransformStream({
    transform(chunk, controller) {
      buffer += decoder.decode(chunk, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const text = extract(line.trim());
        if (text) controller.enqueue(encoder.encode(text));
      }
    },
  });
}

async function streamAnthropic(system: string, messages: ChatMessage[]): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": process.env.ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 1500,
      stream: true,
      system,
      messages,
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Anthropic ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.body.pipeThrough(
    lineTransform((line) => {
      if (!line.startsWith("data:")) return null;
      try {
        const evt = JSON.parse(line.slice(5).trim());
        return evt.type === "content_block_delta" ? (evt.delta?.text ?? null) : null;
      } catch {
        return null;
      }
    }),
  );
}

async function streamOllama(system: string, messages: ChatMessage[]): Promise<ReadableStream<Uint8Array>> {
  const res = await fetch(`${OLLAMA_URL}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      stream: true,
      messages: [{ role: "system", content: system }, ...messages],
    }),
  });
  if (!res.ok || !res.body) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status}: ${detail.slice(0, 200)}`);
  }
  return res.body.pipeThrough(
    lineTransform((line) => {
      if (!line) return null;
      try {
        return JSON.parse(line).message?.content ?? null;
      } catch {
        return null;
      }
    }),
  );
}
