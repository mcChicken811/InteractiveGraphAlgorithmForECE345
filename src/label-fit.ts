/**
 * Font size for a short label (an algorithm's label inside a vertex, e.g. DFS's "12,15")
 * so it fits across `width` px: `max` when it fits, smaller (in half-pixel steps) when
 * it doesn't. Widths are estimated, not measured, so this works without layout.
 */
export function fitFontSize(text: string, width: number, max: number): number {
  let ems = 0;
  for (const ch of text) ems += NARROW.has(ch) ? 0.3 : 0.62; // digits are ~0.6em in UI fonts
  if (ems === 0) return max;
  return Math.min(max, Math.floor((width / ems) * 2) / 2);
}

const NARROW = new Set([',', '.', ' ', ':', ';', '|', '!', 'i', 'l']);
