// JSON for an inline <script> (JSON-LD, bootstrapped values). Plain JSON.stringify does NOT make a
// string safe inside <script>: a value containing "</script>" closes the element and the rest runs
// as HTML. Restaurant and menu-item names are partner-controlled, so the storefront JSON-LD was a
// stored-XSS sink (found by the view-as web verifier, 2026-10-04). Escaping <, >, & and the two JS
// line terminators (U+2028, U+2029) as \uXXXX keeps the JSON byte-for-byte equivalent once parsed.
const UNSAFE: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

export function jsonForScript(value: unknown): string {
  return JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, (ch) => UNSAFE[ch]);
}
