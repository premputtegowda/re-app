import type { CoCAcquisition, ProFormaData, ProFormaItem } from '@/types';

// Canonical human-readable label per AI category key. Used as the pro-forma
// expense name so both views show the same wording.
export const CANONICAL_LABEL: Record<string, string> = {
  real_estate_taxes: 'Real Estate Taxes',
  insurance: 'Insurance',
  insurance_rider_mtr_str: 'Insurance Rider (MTR/STR)',
  licenses_and_permits: 'Licenses & Permits',
  utilities: 'Utilities (common area)',
  utilities_bundled_mtr_str: 'Utilities Bundled (MTR/STR)',
  utility_rubs_recovery: 'Less: RUBS Recovery',
  internet_wifi: 'Internet / WiFi (MTR/STR)',
  streaming_cable: 'Streaming / Cable (MTR/STR)',
  repairs_and_maintenance_ltr: 'Repairs & Maintenance (LTR)',
  repairs_and_maintenance_mtr: 'Repairs & Maintenance (MTR)',
  turnover_ltr: 'Turnover / Make-Ready (LTR)',
  turnover_mtr: 'Turnover / Make-Ready (MTR)',
  ff_e_reserve: 'FF&E Reserve (MTR/STR)',
  consumables: 'Consumables (MTR/STR)',
  contract_services_snow_removal: 'Contract — Snow Removal',
  contract_services_lawn_maintenance: 'Contract — Lawn',
  contract_services_pest_control: 'Contract — Pest Control',
  contract_services_trash_recycling: 'Contract — Trash & Recycling',
  contract_services_janitorial: 'Contract — Janitorial',
  contract_services_security_fire_safety: 'Contract — Security / Fire',
  contract_services_elevator: 'Contract — Elevator',
  contract_services_pool_amenities: 'Contract — Pool / Amenities',
  marketing_ltr: 'Marketing & Leasing (LTR)',
  marketing_mtr: 'Marketing & Leasing (MTR)',
  general_and_administrative: 'G&A',
  payroll: 'Payroll',
  property_management_ltr: 'Property Management (LTR)',
  property_management_mtr: 'Property Management (MTR)',
  capex_reserves: 'CapEx Reserves',
};

// Categories that must remain fixed as % of EGI (per underwriting rules).
const PERCENT_OF_EGI_CATEGORIES = new Set([
  'property_management_ltr', 'property_management_mtr',
  'repairs_and_maintenance_ltr', 'repairs_and_maintenance_mtr',
]);
const FIXED_EGI_PCT: Record<string, number> = {
  property_management_ltr: 8,
  property_management_mtr: 15,
  repairs_and_maintenance_ltr: 8,
  repairs_and_maintenance_mtr: 10,
};

// Canonical AI OpEx categories. Kept in a single ordered list so the
// AssumptionsEditor renders consistently regardless of source.
const AI_CATEGORIES = [
  'real_estate_taxes',
  'insurance',
  'insurance_rider_mtr_str',
  'licenses_and_permits',
  'utilities',
  'utilities_bundled_mtr_str',
  'utility_rubs_recovery',
  'internet_wifi',
  'streaming_cable',
  'repairs_and_maintenance_ltr',
  'repairs_and_maintenance_mtr',
  'turnover_ltr',
  'turnover_mtr',
  'ff_e_reserve',
  'consumables',
  'contract_services_snow_removal',
  'contract_services_lawn_maintenance',
  'contract_services_pest_control',
  'contract_services_trash_recycling',
  'contract_services_janitorial',
  'contract_services_security_fire_safety',
  'contract_services_elevator',
  'contract_services_pool_amenities',
  'marketing_ltr',
  'marketing_mtr',
  'general_and_administrative',
  'payroll',
  'property_management_ltr',
  'property_management_mtr',
  'capex_reserves',
] as const;

type AiCategory = (typeof AI_CATEGORIES)[number];

// Substrings we look for on a pro-forma expense's user-facing name to map it
// onto one of the fixed AI categories. First match wins; order matters where
// multiple could match (e.g. "property mgmt" must beat generic "management").
const NAME_MATCHERS: Array<[AiCategory, RegExp]> = [
  // Order matters — more specific patterns first
  ['insurance_rider_mtr_str',              /insurance.*rider|rider.*insurance|str insurance|mtr insurance/i],
  ['utilities_bundled_mtr_str',            /(utilit.*bundled|bundled.*utilit)/i],
  ['internet_wifi',                        /(internet|wifi|wi-fi|broadband)/i],
  ['streaming_cable',                      /(streaming|cable|netflix)/i],
  ['ff_e_reserve',                         /(ff&e|ffe|furniture reserve|furnish)/i],
  ['consumables',                          /(consumable|toiletr|linens?|supplies)/i],
  ['capex_reserves',                       /(cap ?ex|capital ?expend|replacement ?reserv|repl ?reserv)/i],
  ['real_estate_taxes',                    /\b(real estate tax|property tax|re tax|taxes?)\b/i],
  ['insurance',                            /insurance/i],
  ['licenses_and_permits',                 /(licens|permit)/i],
  ['utility_rubs_recovery',                /(rubs|utility recovery|utility reimburs)/i],
  ['utilities',                            /utilit/i],
  ['repairs_and_maintenance_mtr',          /(repair|maint|r&m|r ?and ?m).*mtr/i],
  ['repairs_and_maintenance_ltr',          /(repair|maint|r&m|r ?and ?m)/i],
  ['turnover_mtr',                         /(turnover|make.?ready).*mtr/i],
  ['turnover_ltr',                         /(turnover|make.?ready)/i],
  ['contract_services_snow_removal',       /snow/i],
  ['contract_services_lawn_maintenance',   /(lawn|landscap)/i],
  ['contract_services_pest_control',       /pest/i],
  ['contract_services_trash_recycling',    /(trash|recycl|garbage|waste)/i],
  ['contract_services_janitorial',         /(janitor|cleaning)/i],
  ['contract_services_security_fire_safety', /(security|fire|life safety)/i],
  ['contract_services_elevator',           /elevator/i],
  ['contract_services_pool_amenities',     /(pool|amenit)/i],
  ['marketing_mtr',                        /(marketing|leasing|advertis).*mtr/i],
  ['marketing_ltr',                        /(marketing|leasing|advertis)/i],
  ['general_and_administrative',           /(general|admin|g&a)/i],
  ['payroll',                              /(payroll|salar|wages)/i],
  ['property_management_mtr',              /(property (mgmt|management)|management fee).*mtr/i],
  ['property_management_ltr',              /(property (mgmt|management)|management fee)/i],
];

function classifyExpenseName(name: string): AiCategory | null {
  for (const [category, re] of NAME_MATCHERS) {
    if (re.test(name)) return category;
  }
  return null;
}

/** Apply an AssumptionsEditor OpEx edit ($ annual value) to proForma.expenses[]. */
export function syncOpexToProForma(
  proForma: ProFormaData,
  category: string,
  newAnnual: number,
  egiEstimate: number,
  defaultExpenseGrowthPct = 2,
  insuranceGrowthPct = 5,
  ltrEgi?: number,
  mtrEgi?: number,
): ProFormaData {
  const canonicalName = CANONICAL_LABEL[category] ?? category;
  const isEgiPct = PERCENT_OF_EGI_CATEGORIES.has(category);
  const isInsurance = category === 'insurance';

  // Per-strategy categories are stored as % of the strategy-specific EGI so
  // the projector can multiply against `getEGIByStrategy(year)` and get the
  // correct dollar amount. Fall back to total EGI when the caller hasn't
  // provided the split (older code paths).
  const strategySuffix: 'ltr' | 'mtr' | null =
    category.endsWith('_ltr') ? 'ltr' :
    category.endsWith('_mtr') ? 'mtr' : null;
  const effectiveEgi =
    strategySuffix === 'ltr' && ltrEgi !== undefined ? ltrEgi :
    strategySuffix === 'mtr' && mtrEgi !== undefined ? mtrEgi :
    egiEstimate;

  // Locate existing expense by (a) matching category via fuzzy name classifier
  // or (b) exact canonical name match. We accept either so old pro-formas
  // (with non-canonical names) still line up.
  const existingIndex = proForma.expenses.findIndex((e) => {
    if (e.name === canonicalName) return true;
    const cat = classifyExpenseName(e.name);
    return cat === category;
  });

  let stabilizedValue: number;
  if (isEgiPct) {
    // Derive % from the user's annual $ so bidirectional sync works. Fall
    // back to the FIXED_EGI_PCT default when we don't have an EGI base yet.
    stabilizedValue = effectiveEgi > 0
      ? Math.round((newAnnual / effectiveEgi) * 100 * 100) / 100
      : (FIXED_EGI_PCT[category] ?? 8);
  } else {
    // Store as ANNUAL $ (matches existing pro-forma convention — the
    // projector's `chainedExpenseValue` and NOI calc treat stabilizedValue as
    // annual for fixed-$ items).
    stabilizedValue = Math.round(newAnnual);
  }

  const nextExpenses = [...proForma.expenses];
  const nextGrowth = isInsurance ? insuranceGrowthPct : defaultExpenseGrowthPct;

  if (existingIndex >= 0) {
    const prev = nextExpenses[existingIndex];
    nextExpenses[existingIndex] = {
      ...prev,
      name: canonicalName,
      isPercentOfEGI: isEgiPct,
      stabilizedValue,
      // Preserve existing growth unless the caller wants us to reset it
      growthPct: prev.growthPct,
    };
  } else if (newAnnual > 0 || isEgiPct) {
    // Add new expense — use canonical name and appropriate defaults
    const newItem: ProFormaItem = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
      name: canonicalName,
      isPercentOfEGI: isEgiPct,
      t12Value: stabilizedValue,
      stabValue: null,
      stabilizedValue,
      growthPct: nextGrowth,
    };
    nextExpenses.push(newItem);
  } else {
    // Nothing to sync: value is 0 and no existing expense
    return proForma;
  }

  // Suppress unused var warning when insuranceGrowthPct isn't used
  void egiEstimate;

  return { ...proForma, expenses: nextExpenses };
}

/**
 * Bulk-sync every operating-expense line item from an AI response into
 * `proForma.expenses[]`. Used when a fresh AI response arrives (auto-fire or
 * manual regenerate) and when hydrating an existing deal whose saved
 * aiAssumptions has more categories than pf.expenses.
 *
 * @param mode
 *   - `'overwrite'` — replace existing pf.expenses entries with AI values
 *     (use after a fresh regenerate)
 *   - `'fillMissing'` — only add categories that don't exist yet; leave user
 *     edits alone (use on mount / when hydrating saved deals)
 */
export function bulkSyncAiOpexToProForma(
  proForma: ProFormaData,
  assumptions: Record<string, unknown> | null | undefined,
  egiEstimate: number,
  defaultExpenseGrowthPct = 2,
  insuranceGrowthPct = 5,
  ltrEgi?: number,
  mtrEgi?: number,
  mode: 'overwrite' | 'fillMissing' = 'overwrite',
): ProFormaData {
  const ops = (assumptions?.operating_expenses ?? {}) as Record<string, unknown>;
  if (!ops || Object.keys(ops).length === 0) return proForma;

  let next = proForma;
  for (const category of AI_CATEGORIES) {
    const item = ops[category];
    if (item == null) continue;
    // Normalize AI shape: either a raw number or an object with .annual
    const annual = typeof item === 'number'
      ? item
      : ((item as Record<string, unknown>).annual as number | null | undefined);
    if (annual == null || !Number.isFinite(annual)) continue;

    if (mode === 'fillMissing') {
      const canonicalName = CANONICAL_LABEL[category] ?? category;
      const alreadyPresent = next.expenses.some((e) => {
        if (e.name === canonicalName) return true;
        const c = classifyExpenseName(e.name);
        return c === category;
      });
      if (alreadyPresent) continue;
    }
    next = syncOpexToProForma(
      next, category, annual, egiEstimate,
      defaultExpenseGrowthPct, insuranceGrowthPct,
      ltrEgi, mtrEgi,
    );
  }
  return next;
}

/** Rough EGI proxy for computing % → $ conversions when only stabilized-% values exist. */
function estimateAnnualEgi(acquisition: CoCAcquisition, pf: ProFormaData): number {
  const stabilizedGrossRent = pf.grossRent.stabilized;
  const vacancyPct = pf.vacancyPct.stabilized;
  const creditLossPct = pf.creditLossPct.stabilized;
  const otherIncome = pf.otherIncome.stabilized;
  const baseVac = vacancyPct + creditLossPct;
  const egi = stabilizedGrossRent * (1 - baseVac / 100) + otherIncome;
  // Fallback for uninitialized pro-formas: rough estimate from unit-mix × 12
  if (egi > 0) return egi;
  if (acquisition.propertyType === 'mfr' && acquisition.unitMix?.length) {
    return acquisition.unitMix.reduce(
      (s, u) => s + u.count * (u.rentMonthly || u.inPlaceRent || 0) * 12, 0
    );
  }
  return (acquisition.sfrTargetRent || acquisition.sfrInPlaceRent || 0) * 12;
}

/**
 * Convert an existing pro-forma into the AI-response shape so the AssumptionsEditor
 * has values to display on existing deals without needing to fire the AI.
 */
export function proFormaToAssumptions(
  acquisition: CoCAcquisition,
  proForma: ProFormaData,
): Record<string, unknown> {
  const egi = estimateAnnualEgi(acquisition, proForma);
  const operating_expenses: Record<string, { annual: number; assumption: string; source: string; confidence: string }> = {};
  for (const cat of AI_CATEGORIES) {
    operating_expenses[cat] = { annual: 0, assumption: '', source: '', confidence: '' };
  }

  for (const exp of proForma.expenses ?? []) {
    const category = classifyExpenseName(exp.name);
    if (!category) continue; // unmapped user-custom expense — leave for now
    // stabilizedValue for fixed-$ items is stored as ANNUAL (matches
    // `syncOpexToProForma` line 175-178 + `getOpExForYear` line 415-416).
    // Previously multiplied by 12 assuming monthly — this created a 12×
    // inflation loop: proFormaToAssumptions produced 12× annual, then
    // `bulkSyncAiOpexToProForma` wrote the 12× value back into
    // `pf.expenses[].stabilizedValue`, and the projector rendered it as-is.
    const annual = exp.isPercentOfEGI
      ? egi * (exp.stabilizedValue / 100)
      : exp.stabilizedValue;
    operating_expenses[category] = {
      annual: Math.round(annual),
      assumption: exp.isPercentOfEGI ? `${exp.stabilizedValue}% of EGI` : `${Math.round(annual / 12)}/mo`,
      source: 'From pro forma',
      confidence: '',
    };
  }

  // Rent by unit type — read from acquisition.unitMix or SFR fields.
  const by_unit_type = acquisition.propertyType === 'mfr' && acquisition.unitMix?.length
    ? acquisition.unitMix.map((u) => ({
        unit_type: `${u.beds}BR/${u.baths}BA`,
        count: u.count,
        estimated_in_place_rent_monthly: u.inPlaceRent || 0,
        estimated_market_rent_monthly: u.rentMonthly || 0,
        in_place_source: 'From unit mix',
        market_source: 'From unit mix',
        confidence: '',
      }))
    : [{
        unit_type: `SFR${acquisition.sfrBeds ? ` (${acquisition.sfrBeds}BR/${acquisition.sfrBaths}BA)` : ''}`,
        count: 1,
        estimated_in_place_rent_monthly: acquisition.sfrInPlaceRent || 0,
        estimated_market_rent_monthly: acquisition.sfrTargetRent || 0,
        in_place_source: 'From property data',
        market_source: 'From property data',
        confidence: '',
      }];

  return {
    cap_rate_estimation: {
      current_market_cap_rate_pct: acquisition.exitCapRate > 0 ? acquisition.exitCapRate - 1 : null,
      exit_cap_rate_pct: acquisition.exitCapRate || null,
      assumption: acquisition.exitCapRate > 0
        ? 'Derived from exit cap rate (current = exit − 1%)'
        : '',
      source: acquisition.exitCapRate > 0 ? 'From exit assumptions' : '',
      confidence: '',
    },
    market_rent_estimation: {
      by_unit_type,
      notes: 'Populated from existing deal data. Click Regenerate with AI to refresh with market data.',
    },
    revenue: {
      gross_potential_rent_annual: proForma.grossRent.stabilized || null,
      effective_gross_income_annual: egi || null,
    },
    operating_expenses,
  };
}
