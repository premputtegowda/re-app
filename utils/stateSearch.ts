/** US state name → abbreviation lookup */
export const STATE_ABBR: Record<string, string> = {
  'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA',
  'colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA',
  'hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA',
  'kansas':'KS','kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD',
  'massachusetts':'MA','michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO',
  'montana':'MT','nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ',
  'new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH',
  'oklahoma':'OK','oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC',
  'south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT',
  'virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY',
  'district of columbia':'DC',
};

/**
 * Parse a property address into city + state abbreviation.
 * Handles Mapbox format ("123 Main St, Austin, Texas 78701, United States")
 * and manual entry ("123 Main St, Austin, TX 78701").
 */
export function parseAddress(address: string): { city: string; state: string } {
  const parts = address.split(',').map(s => s.trim());

  let state = '';
  let cityIdx = -1;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    const abbrMatch = p.match(/\b([A-Z]{2})\b/);
    if (abbrMatch) { state = abbrMatch[1]; cityIdx = i - 1; break; }
    const words = p.replace(/\d+/g, '').trim().toLowerCase();
    if (words && STATE_ABBR[words]) { state = STATE_ABBR[words]; cityIdx = i - 1; break; }
  }

  const city = cityIdx >= 0 ? parts[cityIdx].replace(/\d+/g, '').trim() : '';
  return { city, state };
}

/**
 * Normalize a user-entered state filter value to a two-letter abbreviation.
 * Accepts "Texas", "texas", "TX", "tx" → "TX".
 */
export function normalizeStateInput(input: string): string {
  const trimmed = input.trim().toLowerCase();
  return STATE_ABBR[trimmed] ?? trimmed.toUpperCase();
}

/**
 * Check if a deal's address matches a state filter value.
 * The filter can be a full name or abbreviation in any case.
 */
export function matchesState(address: string, filterState: string): boolean {
  if (!filterState) return true;
  const { state } = parseAddress(address);
  return state === normalizeStateInput(filterState);
}
