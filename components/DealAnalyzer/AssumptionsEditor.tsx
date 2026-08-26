'use client';

import React, { useEffect, useMemo, useState } from 'react';

// ── Types matching backend response shape ──────────────────────────────────

interface LineItem {
  annual: number | null;
  assumption?: string;
  source?: string;
  confidence?: string;
}

interface RentEntry {
  unit_type: string;
  count: number;
  estimated_in_place_rent_monthly: number | null;
  estimated_market_rent_monthly: number | null;
  in_place_source?: string;
  market_source?: string;
  confidence?: string;
  // Back-compat: earlier schema used "source"
  source?: string;
}

interface CapRateBlock {
  current_market_cap_rate_pct?: number | null;
  exit_cap_rate_pct?: number | null;
  assumption?: string;
  source?: string;
  confidence?: string;
}

interface AssumptionsShape {
  cap_rate_estimation?: CapRateBlock;
  market_rent_estimation?: {
    by_unit_type?: RentEntry[];
    notes?: string;
  };
  revenue?: {
    gross_potential_rent_annual?: number | null;
    effective_gross_income_annual?: number | null;
  };
  operating_expenses?: Record<string, LineItem | number | null | undefined>;
  noi_annual?: number | null;
  below_the_line?: Record<string, number | null>;
}

// ── Config ──────────────────────────────────────────────────────────────────

type ExpenseRow = { key: string; label: string; help?: string; pctOfEgi?: boolean };

// Common expenses — apply to all units regardless of rental strategy.
// Divide by TOTAL unit count for $/unit displays.
const COMMON_EXPENSES: ExpenseRow[] = [
  { key: 'real_estate_taxes', label: 'Real Estate Taxes' },
  { key: 'insurance', label: 'Insurance' },
  { key: 'licenses_and_permits', label: 'Licenses & Permits' },
  { key: 'utilities', label: 'Utilities (common area)' },
  { key: 'utility_rubs_recovery', label: 'Less: RUBS Recovery' },
  { key: 'contract_services_snow_removal', label: 'Contract — Snow Removal' },
  { key: 'contract_services_lawn_maintenance', label: 'Contract — Lawn' },
  { key: 'contract_services_pest_control', label: 'Contract — Pest Control' },
  { key: 'contract_services_trash_recycling', label: 'Contract — Trash & Recycling' },
  { key: 'contract_services_janitorial', label: 'Contract — Janitorial' },
  { key: 'contract_services_security_fire_safety', label: 'Contract — Security / Fire' },
  { key: 'contract_services_elevator', label: 'Contract — Elevator' },
  { key: 'contract_services_pool_amenities', label: 'Contract — Pool / Amenities' },
  { key: 'general_and_administrative', label: 'G&A' },
  { key: 'payroll', label: 'Payroll' },
  { key: 'capex_reserves', label: 'CapEx Reserves', help: 'Replacement reserves for roof, HVAC, appliances, etc. — typically $250–500/unit/year.' },
];

// LTR-specific — only shown when the property has ≥1 LTR unit.
// Divide by LTR unit count for $/unit displays.
const LTR_EXPENSES: ExpenseRow[] = [
  { key: 'repairs_and_maintenance_ltr', label: 'Repairs & Maintenance', help: '8% of LTR EGI.', pctOfEgi: true },
  { key: 'turnover_ltr', label: 'Turnover / Make-Ready' },
  { key: 'marketing_ltr', label: 'Marketing & Leasing' },
  { key: 'property_management_ltr', label: 'Property Management', help: '8% of LTR EGI.', pctOfEgi: true },
];

// MTR/STR-specific — only shown when the property has ≥1 MTR/STR unit.
// Divide by MTR/STR unit count for $/unit displays.
const MTR_EXPENSES: ExpenseRow[] = [
  { key: 'repairs_and_maintenance_mtr', label: 'Repairs & Maintenance', help: '10% of MTR EGI (higher wear from frequent turnovers).', pctOfEgi: true },
  { key: 'turnover_mtr', label: 'Turnover / Make-Ready', help: 'Higher turnover frequency + deep-clean per stay. Only MTR/STR units.' },
  { key: 'marketing_mtr', label: 'Marketing & Leasing', help: 'Furnished platform subs + listing fees + higher turnover freq. Only MTR/STR units.' },
  { key: 'property_management_mtr', label: 'Property Management', help: '15% of MTR EGI (higher coordination + guest turnover).', pctOfEgi: true },
  { key: 'insurance_rider_mtr_str', label: 'Insurance Rider', help: 'Furnished / short-stay coverage rider on top of base insurance.' },
  { key: 'utilities_bundled_mtr_str', label: 'Utilities Bundled', help: 'Landlord-paid electric, water, gas, and trash bundled into rent.' },
  { key: 'internet_wifi', label: 'Internet / WiFi', help: 'Mandatory internet for furnished rentals (~$60-100/unit/mo).' },
  { key: 'streaming_cable', label: 'Streaming / Cable', help: 'Streaming subscription or cable (~$20-40/unit/mo).' },
  { key: 'ff_e_reserve', label: 'FF&E Reserve', help: 'Furniture, fixtures, and equipment reserve for wear + replacement (~$300-600/unit/yr).' },
  { key: 'consumables', label: 'Consumables', help: 'Cleaning supplies, toiletries (soap, shampoo, TP), coffee/pantry, linens + towel replacement. Typically $50-100/unit/mo.' },
];

const ALL_EXPENSE_KEYS = [...COMMON_EXPENSES, ...LTR_EXPENSES, ...MTR_EXPENSES];

const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 });

function confBadge(conf?: string) {
  const c = (conf || '').toLowerCase();
  const cls =
    c === 'high'
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300'
      : c === 'medium'
        ? 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'
        : c === 'low'
          ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300'
          : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400';
  return (
    <span className={`text-[9px] px-1.5 py-0.5 rounded font-medium uppercase ${cls}`}>
      {conf || '—'}
    </span>
  );
}

// ── Override styling ────────────────────────────────────────────────────────

/** Numbers that differ by less than $0.01 are considered equal (avoid float noise). */
function isOverridden(current: number | null | undefined, original: number | null | undefined): boolean {
  const c = current ?? 0;
  const o = original ?? 0;
  return Math.abs(c - o) > 0.01;
}

const INPUT_BASE = 'w-full px-2 py-1 text-sm text-right tabular-nums border rounded';
const INPUT_DEFAULT = 'bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600';
const INPUT_OVERRIDDEN = 'bg-blue-50 dark:bg-blue-900/20 border-blue-400 dark:border-blue-500 ring-1 ring-blue-200 dark:ring-blue-800';

function overrideCls(overridden: boolean): string {
  return `${INPUT_BASE} ${overridden ? INPUT_OVERRIDDEN : INPUT_DEFAULT}`;
}

// ── Tri-Input: three synced numeric fields (annual / per-unit-yr / per-unit-mo) ──

function TriInput({
  annual, unitCount, onChange, disabled, overridden,
}: {
  annual: number;
  unitCount: number;
  onChange: (annual: number) => void;
  disabled?: boolean;
  overridden?: boolean;
}) {
  const perYr = unitCount > 0 ? annual / unitCount : 0;
  const perMo = unitCount > 0 ? annual / (unitCount * 12) : 0;

  const cls = `${overrideCls(!!overridden)} ${disabled ? 'opacity-60' : ''}`;

  return (
    <div className="grid grid-cols-3 gap-1.5">
      <input
        type="number" disabled={disabled}
        value={Number.isFinite(annual) ? annual.toFixed(0) : ''}
        onChange={(e) => onChange(Number(e.target.value) || 0)}
        className={cls}
      />
      <input
        type="number" disabled={disabled}
        value={Number.isFinite(perYr) ? perYr.toFixed(0) : ''}
        onChange={(e) => onChange((Number(e.target.value) || 0) * Math.max(unitCount, 1))}
        className={cls}
      />
      <input
        type="number" disabled={disabled}
        value={Number.isFinite(perMo) ? perMo.toFixed(0) : ''}
        onChange={(e) => onChange((Number(e.target.value) || 0) * Math.max(unitCount, 1) * 12)}
        className={cls}
      />
    </div>
  );
}

// ── Normalization ───────────────────────────────────────────────────────────

function normalizeLine(v: LineItem | number | null | undefined): LineItem {
  if (v == null) return { annual: null };
  if (typeof v === 'number') return { annual: v };
  if (typeof v === 'object') return v;
  return { annual: null };
}

// ── Main component ─────────────────────────────────────────────────────────

interface AssumptionsEditorProps {
  raw: AssumptionsShape;
  /** Total unit count — used for Common-section per-unit denominators. */
  unitCount: number;
  /** LTR unit count — used for LTR-specific per-unit denominators. Defaults to unitCount when absent. */
  ltrUnitCount?: number;
  /** MTR/STR unit count — used for MTR-specific per-unit denominators. Defaults to unitCount when absent. */
  mtrUnitCount?: number;
  /** Optional: called whenever the user edits an OpEx annual value.
   *  Parent uses this to sync the change into proForma.expenses[]. */
  onOpexChange?: (category: string, annual: number) => void;
  /** Optional: called whenever the user edits a per-unit-type rent value.
   *  Parent uses this to sync into acquisition.unitMix or SFR fields. */
  onRentChange?: (unitTypeIndex: number, field: 'in_place' | 'market', monthly: number) => void;
  /** Optional: called whenever the user edits the entry or exit cap rate. */
  onCapRateChange?: (field: 'entry' | 'exit', pct: number) => void;
  /** Per-unit-type rental strategy (LTR/MTR/STR) — same length + order as raw.market_rent_estimation.by_unit_type. */
  rentalTypes?: (string | undefined)[];
}

/** Format a decimal number for display in an <input type="number">.
 *  Shows up to 2 decimal places but drops trailing zeros so users can type
 *  freely without fighting auto-added zeros. Examples: 7 → "7", 7.2 → "7.2",
 *  7.25 → "7.25", 7.253 → "7.25" (rounded). */
function fmtCapPct(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0';
  return String(Math.round(n * 100) / 100);
}

function rentalTypeBadge(type: string | undefined) {
  if (!type) return null;
  const cls = type === 'STR'
    ? 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300'
    : type === 'MTR'
      ? 'bg-primary-100 text-primary-800 dark:bg-primary-900/40 dark:text-primary-300'
      : 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300';
  return (
    <span className={`ml-1.5 text-[9px] px-1.5 py-0.5 rounded font-semibold uppercase ${cls}`}>
      {type}
    </span>
  );
}

export function AssumptionsEditor({ raw, unitCount, ltrUnitCount, mtrUnitCount, onOpexChange, onRentChange, onCapRateChange, rentalTypes }: AssumptionsEditorProps) {
  const effectiveLtrCount = ltrUnitCount ?? unitCount;
  const effectiveMtrCount = mtrUnitCount ?? 0;
  const hasLtr = effectiveLtrCount > 0;
  const hasMtr = effectiveMtrCount > 0;
  // Editable state — initialized from AI response, mutated by user
  const [rentByType, setRentByType] = useState<RentEntry[]>([]);
  const [expenses, setExpenses] = useState<Record<string, LineItem>>({});
  const [entryCap, setEntryCap] = useState<number>(0);
  const [exitCap, setExitCap] = useState<number>(0);
  // Track whether user has manually overridden exit cap so we don't stomp on
  // their edit when they change entry cap afterward.
  const [exitCapUserOverridden, setExitCapUserOverridden] = useState(false);

  // ORIGINAL AI values — used to detect user overrides for visual styling.
  const [originalRent, setOriginalRent] = useState<RentEntry[]>([]);
  const [originalExpenses, setOriginalExpenses] = useState<Record<string, LineItem>>({});
  const [originalEntryCap, setOriginalEntryCap] = useState<number>(0);
  const [originalExitCap, setOriginalExitCap] = useState<number>(0);

  // Rehydrate rents + opex whenever a new AI response comes in. Cap rate is
  // handled by a separate effect below with a value-based guard — since the
  // parent re-creates `raw` on every edit (spread operator in
  // onCapRateChange), a naive setEntryCap in this effect would fire on every
  // keystroke and could clobber the user's mid-edit typing.
  useEffect(() => {
    const rents = raw.market_rent_estimation?.by_unit_type ?? [];
    setRentByType(rents);
    setOriginalRent(JSON.parse(JSON.stringify(rents)));

    const ops = raw.operating_expenses ?? {};
    const norm: Record<string, LineItem> = {};
    for (const { key } of ALL_EXPENSE_KEYS) {
      norm[key] = normalizeLine(ops[key]);
    }
    setExpenses(norm);
    setOriginalExpenses(JSON.parse(JSON.stringify(norm)));
  }, [raw]);

  // Cap rate sync — only fires when raw's numeric value actually differs
  // (deps are the scalar values, not the raw reference). Matches the rent
  // input pattern which uses simple `value={number.toFixed(0)}` + `onChange`.
  const rawEntryCap = raw.cap_rate_estimation?.current_market_cap_rate_pct ?? 0;
  const rawExitCap = raw.cap_rate_estimation?.exit_cap_rate_pct ?? 0;
  useEffect(() => {
    setEntryCap(rawEntryCap);
    setOriginalEntryCap(rawEntryCap);
    const exit = rawExitCap > 0 ? rawExitCap : (rawEntryCap > 0 ? rawEntryCap + 1.0 : 0);
    setExitCap(exit);
    setOriginalExitCap(exit);
    setExitCapUserOverridden(false);
  }, [rawEntryCap, rawExitCap]);

  // Auto-sync exit cap to entry + 1% when entry changes, unless user has overridden
  function updateEntryCap(v: number) {
    setEntryCap(v);
    onCapRateChange?.('entry', v);
    if (!exitCapUserOverridden && v > 0) {
      const nextExit = Number((v + 1.0).toFixed(3));
      setExitCap(nextExit);
      onCapRateChange?.('exit', nextExit);
    }
  }
  function updateExitCap(v: number) {
    setExitCap(v);
    setExitCapUserOverridden(true);
    onCapRateChange?.('exit', v);
  }

  // GPR = market rent (full potential); Effective in-place = actual current collections
  const gpr = useMemo(
    () => rentByType.reduce((s, r) => s + (r.estimated_market_rent_monthly ?? 0) * r.count * 12, 0),
    [rentByType]
  );
  const inPlaceAnnual = useMemo(
    () => rentByType.reduce((s, r) => s + (r.estimated_in_place_rent_monthly ?? 0) * r.count * 12, 0),
    [rentByType]
  );

  // EGI uses in-place rent (what's actually being collected today). If nothing
  // in-place is known yet, fall back to GPR so downstream math still works.
  const egi = inPlaceAnnual > 0 ? inPlaceAnnual : gpr;

  // Per-strategy EGI — approximation used both for displaying % on the PM/R&M
  // rows and for converting % edits back to $. Anchored on in-place rent
  // (falling back to market) so it matches the total `egi` composition.
  const isLtrIndex = (i: number) => {
    const t = rentalTypes?.[i];
    return !t || t === 'LTR';
  };
  const isMtrIndex = (i: number) => {
    const t = rentalTypes?.[i];
    return t === 'MTR' || t === 'STR';
  };
  const strategyAnnual = (isMatch: (i: number) => boolean): number => {
    let sum = 0;
    rentByType.forEach((r, i) => {
      if (!isMatch(i)) return;
      const monthly = r.estimated_in_place_rent_monthly ?? r.estimated_market_rent_monthly ?? 0;
      sum += monthly * r.count * 12;
    });
    return sum;
  };
  const ltrEgi = useMemo(() => strategyAnnual(isLtrIndex), [rentByType, rentalTypes]);
  const mtrEgi = useMemo(() => strategyAnnual(isMtrIndex), [rentByType, rentalTypes]);

  // Total OpEx: sum of all editable annual values
  const totalOpex = useMemo(
    () => Object.values(expenses).reduce((s, x) => s + (x.annual ?? 0), 0),
    [expenses]
  );

  const noi = egi - totalOpex;

  function updateExpense(key: string, newAnnual: number) {
    setExpenses((prev) => ({
      ...prev,
      [key]: { ...prev[key], annual: newAnnual },
    }));
    // Propagate to parent so proForma stays in sync
    onOpexChange?.(key, newAnnual);
  }

  function updateInPlaceRent(index: number, newRent: number) {
    setRentByType((prev) =>
      prev.map((r, i) => (i === index ? { ...r, estimated_in_place_rent_monthly: newRent } : r))
    );
    onRentChange?.(index, 'in_place', newRent);
  }

  function updateMarketRent(index: number, newRent: number) {
    setRentByType((prev) =>
      prev.map((r, i) => (i === index ? { ...r, estimated_market_rent_monthly: newRent } : r))
    );
    onRentChange?.(index, 'market', newRent);
  }

  return (
    <div className="space-y-6">
      {/* ── Cap Rates ──────────────────────────────────────────────────── */}
      <section className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-800/50">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">Cap Rate Assumptions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Current Market Cap (%)
              {isOverridden(entryCap, originalEntryCap) && (
                <span className="ml-1.5 text-[10px] text-blue-600 dark:text-blue-400 font-semibold">EDITED</span>
              )}
            </label>
            <input
              type="number" step={0.01} min={0}
              placeholder="e.g. 7.25"
              value={entryCap || ''}
              onChange={(e) => updateEntryCap(Number(e.target.value))}
              className={`w-full px-3 py-2 rounded-md text-sm text-right tabular-nums border ${
                isOverridden(entryCap, originalEntryCap) ? INPUT_OVERRIDDEN : INPUT_DEFAULT
              }`}
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Implied value at NOI: {entryCap > 0 ? `$${fmt(noi / (entryCap / 100))}` : '—'}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
              Exit Cap (%)
              {isOverridden(exitCap, originalExitCap) && (
                <span className="ml-1.5 text-[10px] text-blue-600 dark:text-blue-400 font-semibold">EDITED</span>
              )}
              {!exitCapUserOverridden && !isOverridden(exitCap, originalExitCap) && entryCap > 0 && (
                <span className="ml-1.5 text-[10px] text-slate-400">(auto = entry + 1.0)</span>
              )}
            </label>
            <input
              type="number" step={0.01} min={0}
              placeholder="e.g. 8.25"
              value={exitCap || ''}
              onChange={(e) => updateExitCap(Number(e.target.value))}
              className={`w-full px-3 py-2 rounded-md text-sm text-right tabular-nums border ${
                isOverridden(exitCap, originalExitCap) ? INPUT_OVERRIDDEN : INPUT_DEFAULT
              }`}
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Spread: {entryCap > 0 && exitCap > 0 ? `+${(exitCap - entryCap).toFixed(2)}%` : '—'}
            </p>
          </div>
          <div className="text-[11px] text-slate-500 dark:text-slate-400 sm:pt-6">
            {confBadge(raw.cap_rate_estimation?.confidence)}
            <p className="mt-1">{raw.cap_rate_estimation?.assumption || '—'}</p>
            {raw.cap_rate_estimation?.source && raw.cap_rate_estimation.source.startsWith('http') ? (
              <a href={raw.cap_rate_estimation.source} target="_blank" rel="noreferrer" className="text-primary-500 hover:underline break-all">
                {raw.cap_rate_estimation.source}
              </a>
            ) : (
              <span className="text-slate-400">{raw.cap_rate_estimation?.source || ''}</span>
            )}
          </div>
        </div>
      </section>

      {/* ── Rent Information ────────────────────────────────────────────── */}
      <section>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2">
          Rent Information
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="text-left py-2 pr-2">Unit Type</th>
                <th className="text-right py-2 pr-2">Count</th>
                <th className="text-right py-2 pr-2">In-Place $/mo</th>
                <th className="text-right py-2 pr-2">Market $/mo</th>
                <th className="text-right py-2 pr-2">LTL</th>
                <th className="text-right py-2 pr-2">In-Place $/yr (total)</th>
                <th className="text-right py-2 pr-2">Market $/yr (total)</th>
                <th className="text-left py-2 pr-2 w-16">Conf</th>
              </tr>
            </thead>
            <tbody>
              {rentByType.map((r, i) => {
                const inPlaceMo = r.estimated_in_place_rent_monthly ?? 0;
                const marketMo = r.estimated_market_rent_monthly ?? 0;
                const ltlPct = marketMo > 0 ? ((marketMo - inPlaceMo) / marketMo) * 100 : 0;
                const inPlaceOrig = originalRent[i]?.estimated_in_place_rent_monthly ?? 0;
                const marketOrig = originalRent[i]?.estimated_market_rent_monthly ?? 0;
                const inPlaceEdited = isOverridden(inPlaceMo, inPlaceOrig);
                const marketEdited = isOverridden(marketMo, marketOrig);
                const inPlaceCellCls = `w-24 px-2 py-1 text-sm text-right tabular-nums border rounded ${inPlaceEdited ? INPUT_OVERRIDDEN : INPUT_DEFAULT}`;
                const marketCellCls = `w-24 px-2 py-1 text-sm text-right tabular-nums border rounded ${marketEdited ? INPUT_OVERRIDDEN : INPUT_DEFAULT}`;
                return (
                  <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                    <td className="py-1.5 pr-2 text-slate-700 dark:text-slate-300">
                      {r.unit_type}
                      {rentalTypeBadge(rentalTypes?.[i])}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">{r.count}</td>
                    <td className="py-1.5 pr-2 text-right">
                      <input type="number" value={inPlaceMo.toFixed(0)}
                        onChange={(e) => updateInPlaceRent(i, Number(e.target.value) || 0)}
                        className={inPlaceCellCls} />
                    </td>
                    <td className="py-1.5 pr-2 text-right">
                      <input type="number" value={marketMo.toFixed(0)}
                        onChange={(e) => updateMarketRent(i, Number(e.target.value) || 0)}
                        className={marketCellCls} />
                    </td>
                    <td className={`py-1.5 pr-2 text-right tabular-nums text-xs ${ltlPct > 0 ? 'text-amber-600' : 'text-slate-400'}`}>
                      {marketMo > 0 ? `${ltlPct.toFixed(1)}%` : '—'}
                    </td>
                    <td className="py-1.5 pr-2 text-right tabular-nums">${fmt(inPlaceMo * 12 * r.count)}</td>
                    <td className="py-1.5 pr-2 text-right tabular-nums font-semibold">${fmt(marketMo * 12 * r.count)}</td>
                    <td className="py-1.5 pr-2">{confBadge(r.confidence)}</td>
                  </tr>
                );
              })}
              <tr className="border-b border-slate-300 dark:border-slate-600 font-semibold">
                <td className="py-1.5 pr-2 text-slate-800 dark:text-slate-200" colSpan={5}>
                  Annual totals
                </td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-slate-700 dark:text-slate-300">${fmt(inPlaceAnnual)}</td>
                <td className="py-1.5 pr-2 text-right tabular-nums text-primary-600">${fmt(gpr)}</td>
                <td></td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-2">
          <span className="font-medium">In-Place</span>: current tenant rent (used for Year-1 EGI). <span className="font-medium">Market</span>: what a new lease would rent for today. <span className="font-medium">LTL</span> = loss to lease.
        </p>
        {raw.market_rent_estimation?.notes && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 italic">
            {raw.market_rent_estimation.notes}
          </p>
        )}
      </section>

      {/* ── Operating Expenses ──────────────────────────────────────────── */}
      <section>
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-2">
          Operating Expenses (edit any of the three values — others sync)
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 dark:border-slate-700 text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                <th className="text-left py-2 pr-2 w-56">Line Item</th>
                <th className="py-2 pr-2">
                  <div className="grid grid-cols-3 gap-1.5 text-right">
                    <span>Total $/yr</span>
                    <span>$/unit/yr</span>
                    <span>$/unit/mo</span>
                  </div>
                </th>
                <th className="text-left py-2 pr-2 w-16">Conf</th>
                <th className="text-left py-2 pr-2">Reasoning</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                // Sections rendered conditionally based on which strategies are
                // present. Headers only appear when at least two sections are
                // shown (LTR-only or MTR-only properties get a single flat list).
                // `sectionEgi` is the EGI used for the editable % on PM/R&M
                // rows; Common expenses fall back to total EGI.
                const sections: Array<{
                  label: string | null;
                  rows: ExpenseRow[];
                  unitCount: number;
                  sectionEgi: number;
                }> = [];
                sections.push({ label: null, rows: COMMON_EXPENSES, unitCount, sectionEgi: egi });
                if (hasLtr) sections.push({ label: 'LTR-Specific', rows: LTR_EXPENSES, unitCount: effectiveLtrCount, sectionEgi: ltrEgi });
                if (hasMtr) sections.push({ label: 'MTR-Specific', rows: MTR_EXPENSES, unitCount: effectiveMtrCount, sectionEgi: mtrEgi });
                // Only show section headers when BOTH LTR and MTR are present.
                // Single-strategy deals show a flat list — the "MTR-Specific"
                // divider is meaningless when there's no LTR to distinguish from.
                const showHeaders = hasLtr && hasMtr;

                const renderRow = (row: ExpenseRow, rowUnitCount: number, sectionEgi: number) => {
                  const item = expenses[row.key];
                  if (!item) return null;
                  const origAnnual = originalExpenses[row.key]?.annual ?? 0;
                  const edited = isOverridden(item.annual, origAnnual);
                  const showPct = !!row.pctOfEgi;
                  const pctValue = showPct && sectionEgi > 0
                    ? Math.round(((item.annual ?? 0) / sectionEgi) * 100 * 10) / 10
                    : 0;
                  return (
                    <tr key={row.key} className="border-b border-slate-100 dark:border-slate-800 align-top">
                      <td className="py-1.5 pr-2 text-slate-700 dark:text-slate-300">
                        <span className="inline-flex items-center gap-1 flex-wrap">
                          <span>{row.label}</span>
                          {showPct && (
                            <span className="inline-flex items-center gap-0.5">
                              <input
                                type="number"
                                step={0.1} min={0} max={100}
                                value={Number.isFinite(pctValue) ? pctValue : 0}
                                disabled={sectionEgi <= 0}
                                onChange={(e) => {
                                  const newPct = Number(e.target.value) || 0;
                                  const newAnnual = Math.round(sectionEgi * newPct / 100);
                                  updateExpense(row.key, newAnnual);
                                }}
                                className={`w-12 px-1 py-0.5 text-[11px] text-right tabular-nums border rounded ${
                                  edited ? INPUT_OVERRIDDEN : INPUT_DEFAULT
                                } ${sectionEgi <= 0 ? 'opacity-50' : ''}`}
                                title={sectionEgi > 0
                                  ? `${pctValue}% of ${row.key.endsWith('_mtr') ? 'MTR' : row.key.endsWith('_ltr') ? 'LTR' : 'total'} EGI ($${fmt(sectionEgi)}/yr)`
                                  : 'Enter rents to enable % editing'}
                              />
                              <span className="text-[10px] text-slate-500 dark:text-slate-400">%</span>
                            </span>
                          )}
                          {row.help && (
                            <span
                              title={row.help}
                              className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-[8px] font-bold cursor-help"
                            >
                              ?
                            </span>
                          )}
                        </span>
                        {edited && (
                          <span className="ml-1.5 text-[9px] text-blue-600 dark:text-blue-400 font-semibold uppercase">edited</span>
                        )}
                      </td>
                      <td className="py-1.5 pr-2">
                        <TriInput
                          annual={item.annual ?? 0}
                          unitCount={rowUnitCount}
                          onChange={(v) => updateExpense(row.key, v)}
                          overridden={edited}
                        />
                      </td>
                      <td className="py-1.5 pr-2">{confBadge(item.confidence)}</td>
                      <td className="py-1.5 pr-2 text-[11px] text-slate-500 dark:text-slate-400 max-w-md">
                        <p className="mb-0.5">{item.assumption || '—'}</p>
                        {item.source && item.source.startsWith('http') ? (
                          <a href={item.source} target="_blank" rel="noreferrer" className="text-primary-500 hover:underline break-all">
                            {item.source}
                          </a>
                        ) : (
                          <span className="text-slate-400">{item.source || '—'}</span>
                        )}
                      </td>
                    </tr>
                  );
                };

                return sections.flatMap((section, sIdx) => {
                  const items: JSX.Element[] = [];
                  if (showHeaders && section.label) {
                    items.push(
                      <tr key={`header-${sIdx}`}>
                        <td colSpan={4} className="pt-4 pb-1">
                          <div className="flex items-center gap-2 border-t-2 border-primary-500 pt-2">
                            <span className="text-xs font-bold uppercase tracking-wider text-primary-700 dark:text-primary-400">
                              {section.label}
                            </span>
                            <span className="text-[10px] text-slate-400 dark:text-slate-500 normal-case font-normal">
                              — per-unit denominators use {section.unitCount} unit{section.unitCount !== 1 ? 's' : ''}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  section.rows.forEach((row) => {
                    const el = renderRow(row, section.unitCount, section.sectionEgi);
                    if (el) items.push(el);
                  });
                  return items;
                });
              })()}
              <tr className="border-b border-slate-300 dark:border-slate-600 font-semibold">
                <td className="py-1.5 pr-2 text-slate-800 dark:text-slate-200">Total OpEx</td>
                <td className="py-1.5 pr-2">
                  <div className="grid grid-cols-3 gap-1.5 text-right tabular-nums">
                    <span className="text-primary-600 px-2">${fmt(totalOpex)}</span>
                    <span className="text-slate-500 px-2">${fmt(unitCount > 0 ? totalOpex / unitCount : 0)}</span>
                    <span className="text-slate-500 px-2">${fmt(unitCount > 0 ? totalOpex / (unitCount * 12) : 0)}</span>
                  </div>
                </td>
                <td colSpan={2}></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* NOI summary intentionally removed here — the Assumptions view doesn't
          account for vacancy / credit loss / loss-to-lease, so any NOI shown
          here would be misleading. The proper NOI (with all revenue haircuts
          applied) lives in the Pro Forma Detail on the Results panel. */}
    </div>
  );
}
