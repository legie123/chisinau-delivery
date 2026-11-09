// Menu item tags ("vegan, picant, fără gluten") — one comma-separated input in the editor,
// stored as text[] (menu_items.tags, DB check ≤ 10). Same limits here so the error never
// comes from the DB.
export const MAX_TAGS = 10;
export const MAX_TAG_LENGTH = 24;

export function parseTags(input: string | null | undefined): string[] {
  if (!input) return [];
  const out: string[] = [];
  for (const raw of input.split(",")) {
    const tag = raw.trim().toLowerCase().slice(0, MAX_TAG_LENGTH);
    if (!tag || out.includes(tag)) continue;
    out.push(tag);
    if (out.length === MAX_TAGS) break;
  }
  return out;
}
