/**
 * Pure search helpers safe for client components. Must not import server-only
 * modules (prisma, fs, db).
 */

const ACCENT_PAIRS: Array<[string, string]> = [
  ["á", "a"], ["é", "e"], ["í", "i"], ["ó", "o"], ["ú", "u"],
  ["Á", "a"], ["É", "e"], ["Í", "i"], ["Ó", "o"], ["Ú", "u"],
  ["ñ", "n"], ["Ñ", "n"], ["ü", "u"], ["Ü", "u"],
  ["à", "a"], ["è", "e"], ["ì", "i"], ["ò", "o"], ["ù", "u"],
  ["â", "a"], ["ê", "e"], ["î", "i"], ["ô", "o"], ["û", "u"],
];

export function normalize(s: string): string {
  let out = s.toLowerCase();
  for (const [from, to] of ACCENT_PAIRS) {
    if (out.includes(from)) out = out.split(from).join(to);
  }
  return out;
}

/** Wrap a column expression in nested REPLACE() + LOWER() to fold accents. */
export function unaccentSql(col: string): string {
  let expr = col;
  for (const [from, to] of ACCENT_PAIRS) {
    expr = `REPLACE(${expr},'${from}','${to}')`;
  }
  return `LOWER(${expr})`;
}
