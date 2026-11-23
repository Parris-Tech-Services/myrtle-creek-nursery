// How a product is named on screen, in posts and in reports. Pure.
export const BROAD = 'Greens & herbs';   // catch-all sub-category: its items are named on their own

/** The variety first, the plant in brackets: "Roma (tomato)", "Purple (basil)", "Fig (fruit tree)". */
export function productLabel(p) {
  const c = (p.category || '').trim();
  if (!c || c === BROAD || c.toLowerCase() === p.name.toLowerCase()) return p.name;
  return `${p.name} (${c.toLowerCase().replace(/trees$/, 'tree')})`;
}
