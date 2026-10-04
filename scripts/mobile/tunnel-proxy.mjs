#!/usr/bin/env node
// Allowlist reverse proxy in front of the local Kong gateway (54421), for the phone tunnel.
//
// Why it exists: Kong routes /pg/* to postgres-meta, which runs ARBITRARY SQL with NO
// authentication as role postgres (bypassrls) — Studio's backend. Tunnelling Kong wholesale
// would hand the whole database to anyone holding the trycloudflare URL, whatever the JWT
// secret (found by the adversarial verifier, 2026-10-04). Only the supabase-js data plane may
// pass: /auth /rest /realtime /storage /functions /graphql under /v1. Everything else -> 404.
//
// The path is NORMALIZED before the check and the normalized path is what Kong receives:
// checking the raw URL let "/rest/v1/../../pg/query" pass the allowlist and then be resolved by
// Kong to /pg/query. Encoded slashes/backslashes are refused outright (gateways disagree on
// decoding them). Node built-ins only; WebSocket upgrades (realtime) are passed through.
//
// Usage: node scripts/mobile/tunnel-proxy.mjs <listen-port> [upstream-port]
import http from "node:http";
import net from "node:net";

const UP_HOST = "127.0.0.1";
const UP_PORT = Number(process.argv[3] || 54421);
const LISTEN = Number(process.argv[2] || 54431);
// ponytail: allowlist tracks supabase-js subservices; extend if a new one is used by the apps.
const ALLOW = /^\/(auth|rest|realtime|storage|functions|graphql)\/v1(\/|$)/;

/** Normalized "path?search" if allowed, else null. Exported for the test. */
export function allowedTarget(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.startsWith("/")) return null;
  // encoded "/" "\" or a literal backslash: refuse instead of guessing how Kong decodes them
  if (/%2f|%5c|\\/i.test(rawUrl.split("?")[0])) return null;
  let u;
  try {
    u = new URL(rawUrl, "http://proxy.invalid"); // WHATWG: resolves "..", "%2e%2e", "./"
  } catch {
    return null;
  }
  if (u.origin !== "http://proxy.invalid") return null; // "//host/..." style
  if (!ALLOW.test(u.pathname)) return null;
  return u.pathname + u.search;
}

function start() {
  const srv = http.createServer((req, res) => {
    const target = allowedTarget(req.url);
    if (!target) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("blocked");
      return;
    }
    const up = http.request(
      { host: UP_HOST, port: UP_PORT, method: req.method, path: target, headers: req.headers },
      (pr) => {
        res.writeHead(pr.statusCode || 502, pr.headers);
        pr.pipe(res);
      },
    );
    up.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  });

  srv.on("upgrade", (req, sock, head) => {
    const target = allowedTarget(req.url);
    if (!target) {
      sock.end("HTTP/1.1 404 Not Found\r\n\r\n");
      return;
    }
    const up = net.connect(UP_PORT, UP_HOST, () => {
      up.write(
        `${req.method} ${target} HTTP/1.1\r\n` +
          Object.entries(req.headers)
            .map(([k, v]) => `${k}: ${v}\r\n`)
            .join("") +
          "\r\n",
      );
      if (head && head.length) up.write(head);
      sock.pipe(up);
      up.pipe(sock);
    });
    up.on("error", () => sock.destroy());
    sock.on("error", () => up.destroy());
  });

  srv.listen(LISTEN, "127.0.0.1", () =>
    console.error(`tunnel-proxy 127.0.0.1:${LISTEN} -> Kong ${UP_PORT} (data plane only)`),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) start();
