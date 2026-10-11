// Bulk menu paste: rows copied from Excel / Google Sheets (tab-separated) or a CSV
// with `;`. Columns: Categorie | Produs | Descriere | Preț (MDL). A header row is
// optional. Prices accept "120", "120,50", "120.50 MDL".
export type MenuRow = { category: string; name: string; description: string; price: number };
export type ParseResult = { rows: MenuRow[]; errors: string[] };

const MAX_ROWS = 300;

export function parseMenuSheet(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== "");
  const rows: MenuRow[] = [];
  const errors: string[] = [];
  if (lines.length === 0) return { rows, errors: ["Lipește cel puțin un rând."] };
  const sep = lines[0].includes("\t") ? "\t" : ";";
  const start = /pre[țt]|produs|categor/i.test(lines[0]) && !/\d/.test(lines[0].split(sep)[3] ?? "") ? 1 : 0;
  if (lines.length - start > MAX_ROWS) return { rows, errors: [`Maximum ${MAX_ROWS} de rânduri o dată.`] };

  for (let i = start; i < lines.length; i++) {
    const n = i + 1;
    const cells = lines[i].split(sep).map((c) => c.trim().replace(/^"(.*)"$/, "$1"));
    if (cells.length < 4) {
      errors.push(`Rândul ${n}: sunt necesare 4 coloane (Categorie, Produs, Descriere, Preț).`);
      continue;
    }
    const [category, name, description, rawPrice] = cells;
    const price = Number(rawPrice.replace(/\s|mdl|lei/gi, "").replace(",", "."));
    if (!name) errors.push(`Rândul ${n}: lipsește numele produsului.`);
    else if (!description) errors.push(`Rândul ${n} (${name}): descrierea este obligatorie.`);
    else if (!Number.isFinite(price) || price <= 0) errors.push(`Rândul ${n} (${name}): preț invalid „${rawPrice}”.`);
    else rows.push({ category, name, description, price: Math.round(price * 100) / 100 });
  }
  const seen = new Set<string>();
  for (const r of rows) {
    const key = `${r.category.toLowerCase()}|${r.name.toLowerCase()}`;
    if (seen.has(key)) errors.push(`„${r.name}” apare de două ori în „${r.category || "fără categorie"}”.`);
    seen.add(key);
  }
  return { rows, errors };
}
