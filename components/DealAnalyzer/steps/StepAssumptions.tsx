'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Input } from '@/components/UI/Input';
import { CostItemList } from '../CostItemList';
import { AssumptionsEditor } from '../AssumptionsEditor';
import { api, ApiError } from '@/lib/api';
import { syncOpexToProForma, bulkSyncAiOpexToProForma } from '@/utils/proFormaToAssumptions';
import type { CoCAcquisition, CoCCostItem, ProFormaData } from '@/types';

// Substring match used to find the insurance expense so we can apply the
// insurance-specific growth rate override without affecting other line items.
const INSURANCE_NAME_RE = /insurance/i;

// AI's `market_rent_estimation.by_unit_type[]` is keyed by unit_type string
// (e.g. "2BR/1.0BA") and often CONSOLIDATES rows with the same beds/baths
// into a single entry with `count` = combined. Meanwhile
// `acquisition.unitMix` allows multiple rows with matching beds/baths (a
// user may split them by rentalType, tenancy status, etc.). So positional
// index matching (`byUnitType[i]` for `unitMix[i]`) drops the rent on the
// second-and-later duplicates.
//
// Match by (beds, baths) instead — find the first AI row whose parsed
// unit_type matches the unitMix row's beds+baths.
type AiRentEntry = {
  unit_type?: string;
  count?: number;
  estimated_in_place_rent_monthly?: number | null;
  estimated_market_rent_monthly?: number | null;
};

function parseUnitTypeStr(s: string | undefined): { beds: number; baths: number } | null {
  if (!s) return null;
  const m = s.match(/^(\d+)\s*BR\s*\/\s*([\d.]+)\s*BA/i);
  if (!m) return null;
  const beds = Number(m[1]);
  const baths = Number(m[2]);
  if (!Number.isFinite(beds) || !Number.isFinite(baths)) return null;
  return { beds, baths };
}

function findAiRentForUnit(
  aiByUnitType: readonly AiRentEntry[],
  beds: number,
  baths: number,
): AiRentEntry | null {
  for (const entry of aiByUnitType) {
    const parsed = parseUnitTypeStr(entry.unit_type);
    if (!parsed) continue;
    // Small baths tolerance — AI may return "1.0" or "1"
    if (parsed.beds === beds && Math.abs(parsed.baths - baths) < 0.05) return entry;
  }
  return null;
}

// Same field set the old StepFinancing needed, so the wizard's existing
// validation + persistence hook up without changes.
type FinancingFields = Pick<
  CoCAcquisition,
  | 'purchasePrice'
  | 'downPaymentPct'
  | 'closingCostsPct'
  | 'points'
  | 'additionalFeeItems'
  | 'interestRate'
  | 'loanTermYears'
  | 'ioPeriodMonths'
  | 'projectionYears'
  | 'marketRateAtCreation'
  | 'propertyAddress'
  | 'propertyType'
  | 'unitMix'
  | 'sfrBeds'
  | 'sfrBaths'
  | 'sfrInPlaceRent'
  | 'sfrTargetRent'
  | 'sfrRentalType'
>;

const newItem = (): CoCCostItem => ({
  id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  description: '',
  amount: 0,
});

function formatAsOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

interface CostSummary {
  serper_usd: number;
  serper_search_count: number;
  gemini_usd: number;
  gemini_input_tokens: number;
  gemini_output_tokens: number;
  total_usd: number;
}

interface StepAssumptionsProps {
  data: FinancingFields;
  onChange: (field: keyof CoCAcquisition, value: unknown) => void;
  missingFields?: Set<string>;
  /** True if this is a brand-new deal (no persisted acquisition data yet). Controls whether AI auto-fires. */
  isNewDeal: boolean;
  /** Hoisted at the parent so it survives step navigation. */
  assumptions: Record<string, unknown> | null;
  cost: CostSummary | null;
  onAssumptionsChange: (v: Record<string, unknown> | null) => void;
  onCostChange: (v: CostSummary | null) => void;
  /** Pro-forma source of truth — passed so growth-rate edits sync back into it. */
  proForma: ProFormaData;
  onProFormaChange: (pf: ProFormaData) => void;
}

export function StepAssumptions({
  data, onChange, missingFields, isNewDeal,
  assumptions, cost, onAssumptionsChange, onCostChange,
  proForma, onProFormaChange,
}: StepAssumptionsProps) {
  const isCash = data.downPaymentPct >= 100;
  const warn = (field: string) => missingFields?.has(field) ?? false;

  // ── Growth assumptions — bi-directionally synced with proForma ─────────
  // Income Growth mirrors proForma.grossRent.growthPct (income items share
  // one rate for simplicity). Expense Growth is the default for every non-
  // insurance expense. Insurance Growth is a targeted override on any
  // expense whose name matches /insurance/i.
  const derivedInsuranceGrowth = (() => {
    const ins = proForma.expenses.find((e) => INSURANCE_NAME_RE.test(e.name));
    return ins ? ins.growthPct : 5;
  })();
  const derivedExpenseGrowth = (() => {
    const nonIns = proForma.expenses.filter((e) => !INSURANCE_NAME_RE.test(e.name));
    if (nonIns.length === 0) return 2;
    // Use the mode/first-non-zero for display; if all are 0 default to 2
    const first = nonIns.find((e) => e.growthPct > 0)?.growthPct;
    return first ?? 2;
  })();

  const [incomeGrowthPct, setIncomeGrowthPctLocal] = useState<number>(proForma.grossRent.growthPct || 2);
  const [expenseGrowthPct, setExpenseGrowthPctLocal] = useState<number>(derivedExpenseGrowth);
  const [insuranceGrowthPct, setInsuranceGrowthPctLocal] = useState<number>(derivedInsuranceGrowth);

  // Vacancy & Collections — seed from proForma; defaults 10% / 2% for new deals.
  const [vacancyPct, setVacancyPctLocal] = useState<number>(
    proForma.vacancyPct.stabilized > 0 ? proForma.vacancyPct.stabilized : 10
  );
  const [badDebtPct, setBadDebtPctLocal] = useState<number>(
    proForma.creditLossPct.stabilized > 0 ? proForma.creditLossPct.stabilized : 2
  );

  function setVacancyPct(v: number) {
    setVacancyPctLocal(v);
    onProFormaChange({
      ...proForma,
      vacancyPct: { ...proForma.vacancyPct, stabilized: v },
    });
  }

  /** Effective vacancy % for a specific year — override wins, else stabilized. */
  function getYearVacancy(year: number): number {
    const ov = proForma.yearOverrides?.[year]?.vacancyPct;
    return ov !== undefined ? ov : vacancyPct;
  }

  /** Cascade forward: setting year Y also sets Y+1..N (and updates the base
   *  rate) so the value propagates until another year is explicitly edited. */
  function setYearVacancy(year: number, v: number) {
    if (year === 1) setVacancyPctLocal(v);
    const nextOverrides = { ...(proForma.yearOverrides ?? {}) };
    const maxYear = data.projectionYears || 5;
    for (let y = year; y <= maxYear; y++) {
      nextOverrides[y] = { ...(nextOverrides[y] ?? {}), vacancyPct: v };
    }
    onProFormaChange({
      ...proForma,
      vacancyPct: year === 1 ? { ...proForma.vacancyPct, stabilized: v } : proForma.vacancyPct,
      yearOverrides: nextOverrides,
    });
  }

  function setBadDebtPct(v: number) {
    setBadDebtPctLocal(v);
    onProFormaChange({
      ...proForma,
      creditLossPct: { ...proForma.creditLossPct, stabilized: v },
    });
  }

  function getYearBadDebt(year: number): number {
    const ov = proForma.yearOverrides?.[year]?.creditLossPct;
    return ov !== undefined ? ov : badDebtPct;
  }

  function setYearBadDebt(year: number, v: number) {
    if (year === 1) setBadDebtPctLocal(v);
    const nextOverrides = { ...(proForma.yearOverrides ?? {}) };
    const maxYear = data.projectionYears || 5;
    for (let y = year; y <= maxYear; y++) {
      nextOverrides[y] = { ...(nextOverrides[y] ?? {}), creditLossPct: v };
    }
    onProFormaChange({
      ...proForma,
      creditLossPct: year === 1 ? { ...proForma.creditLossPct, stabilized: v } : proForma.creditLossPct,
      yearOverrides: nextOverrides,
    });
  }

  // MTR-specific vacancy — only relevant when at least one unit type is MTR/STR.
  const hasMtrOrStr =
    (data.propertyType === 'mfr' && (data.unitMix ?? []).some((u) => u.rentalType === 'MTR' || u.rentalType === 'STR'))
    || (data.propertyType === 'sfr' && (data.sfrRentalType === 'MTR' || data.sfrRentalType === 'STR'));

  // LTR vacancy / bad-debt tables should only render when the deal actually
  // has LTR units — otherwise an MTR-only property surfaces the LTR default
  // 5% row and confuses the reader (the projector never applies it).
  const hasLtr =
    (data.propertyType === 'mfr' && (data.unitMix ?? []).some((u) => (u.rentalType ?? 'LTR') === 'LTR'))
    || (data.propertyType === 'sfr' && (data.sfrRentalType ?? 'LTR') === 'LTR');

  const mtrVacancyBase = proForma.vacancyMtrPct?.stabilized ?? 20;

  function getYearMtrVacancy(year: number): number {
    const ov = proForma.yearOverrides?.[year]?.vacancyMtrPct;
    return ov !== undefined ? ov : mtrVacancyBase;
  }

  function setYearMtrVacancy(year: number, v: number) {
    const nextOverrides = { ...(proForma.yearOverrides ?? {}) };
    const maxYear = data.projectionYears || 5;
    for (let y = year; y <= maxYear; y++) {
      nextOverrides[y] = { ...(nextOverrides[y] ?? {}), vacancyMtrPct: v };
    }
    onProFormaChange({
      ...proForma,
      vacancyMtrPct: year === 1 ? { stabilized: v } : (proForma.vacancyMtrPct ?? { stabilized: 20 }),
      yearOverrides: nextOverrides,
    });
  }

  // MTR-specific credit loss (bad debt / concessions) — parallels vacancy.
  const mtrBadDebtBase = proForma.creditLossMtrPct?.stabilized ?? 2;

  function getYearMtrBadDebt(year: number): number {
    const ov = proForma.yearOverrides?.[year]?.creditLossMtrPct;
    return ov !== undefined ? ov : mtrBadDebtBase;
  }

  function setYearMtrBadDebt(year: number, v: number) {
    const nextOverrides = { ...(proForma.yearOverrides ?? {}) };
    const maxYear = data.projectionYears || 5;
    for (let y = year; y <= maxYear; y++) {
      nextOverrides[y] = { ...(nextOverrides[y] ?? {}), creditLossMtrPct: v };
    }
    onProFormaChange({
      ...proForma,
      creditLossMtrPct: year === 1 ? { stabilized: v } : (proForma.creditLossMtrPct ?? { stabilized: 2 }),
      yearOverrides: nextOverrides,
    });
  }

  function setIncomeGrowthPct(v: number) {
    setIncomeGrowthPctLocal(v);
    onProFormaChange({
      ...proForma,
      grossRent: { ...proForma.grossRent, growthPct: v },
      otherIncome: { ...proForma.otherIncome, growthPct: v },
    });
  }

  function setExpenseGrowthPct(v: number) {
    setExpenseGrowthPctLocal(v);
    onProFormaChange({
      ...proForma,
      expenses: proForma.expenses.map((e) =>
        INSURANCE_NAME_RE.test(e.name) ? e : { ...e, growthPct: v }
      ),
    });
  }

  function setInsuranceGrowthPct(v: number) {
    setInsuranceGrowthPctLocal(v);
    onProFormaChange({
      ...proForma,
      expenses: proForma.expenses.map((e) =>
        INSURANCE_NAME_RE.test(e.name) ? { ...e, growthPct: v } : e
      ),
    });
  }

  // AI transient state — loading + error are local to the step; the response
  // itself is hoisted at the parent so it survives step navigation.
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);
  const autoFireRef = useRef(!!assumptions); // if already generated, don't re-fire

  // Compute which required fields are still missing so the user sees the
  // real gap (they've already entered address + unit mix on the Property step;
  // Purchase Price is captured here).
  const missingForAi: string[] = [];
  if (data.propertyAddress.trim().length < 3) missingForAi.push('address');
  if (data.propertyType === 'mfr' && (data.unitMix ?? []).length === 0) missingForAi.push('unit mix');
  if (!(data.purchasePrice > 0)) missingForAi.push('purchase price');
  const canGenerate = missingForAi.length === 0;

  const unitCount = data.propertyType === 'mfr' && data.unitMix
    ? data.unitMix.reduce((s, u) => s + u.count, 0)
    : 1;
  // Per-strategy unit counts for the AssumptionsEditor per-row denominators.
  const ltrUnitCount = data.propertyType === 'mfr' && data.unitMix
    ? data.unitMix.filter((u) => (u.rentalType ?? 'LTR') === 'LTR').reduce((s, u) => s + u.count, 0)
    : ((data.sfrRentalType ?? 'LTR') === 'LTR' ? 1 : 0);
  const mtrUnitCount = data.propertyType === 'mfr' && data.unitMix
    ? data.unitMix.filter((u) => u.rentalType === 'MTR' || u.rentalType === 'STR').reduce((s, u) => s + u.count, 0)
    : ((data.sfrRentalType === 'MTR' || data.sfrRentalType === 'STR') ? 1 : 0);

  // Per-strategy EGI from an AI-response `market_rent_estimation` block plus
  // the current unit-mix rental strategy — anchored on in-place rent
  // (falling back to market). Used by both the bulk sync and single-edit sync
  // paths so the % stored for LTR/MTR PM+R&M lines up on the correct EGI.
  function computePerStrategyEgi(aiResponse: Record<string, unknown> | null): { ltrEgi: number; mtrEgi: number } {
    const rentBlock = (aiResponse?.market_rent_estimation ?? {}) as Record<string, unknown>;
    const byUnitType = ((rentBlock.by_unit_type as unknown[]) ?? []) as Array<{
      count?: number;
      estimated_in_place_rent_monthly?: number | null;
      estimated_market_rent_monthly?: number | null;
    }>;
    const rentalTypesForCalc = data.propertyType === 'mfr' && data.unitMix?.length
      ? data.unitMix.map((u) => u.rentalType ?? 'LTR')
      : [data.sfrRentalType ?? 'LTR'];
    let ltrEgi = 0, mtrEgi = 0;
    byUnitType.forEach((entry, i) => {
      const monthly = entry.estimated_in_place_rent_monthly ?? entry.estimated_market_rent_monthly ?? 0;
      const annualForUnit = (monthly || 0) * (entry.count || 0) * 12;
      const t = rentalTypesForCalc[i] ?? 'LTR';
      if (t === 'MTR' || t === 'STR') mtrEgi += annualForUnit;
      else ltrEgi += annualForUnit;
    });
    return { ltrEgi, mtrEgi };
  }

  async function runAi() {
    if (!canGenerate) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const unit_mix = data.propertyType === 'mfr'
        ? data.unitMix.map((u) => ({
            beds: u.beds,
            baths: u.baths,
            count: u.count,
            in_place_rent_monthly: u.inPlaceRent || 0,
            target_rent_monthly: u.rentMonthly || 0,
            rental_type: (u.rentalType ?? 'LTR') as 'LTR' | 'MTR' | 'STR',
          }))
        : [{
            beds: data.sfrBeds || 0,
            baths: data.sfrBaths || 0,
            count: 1,
            in_place_rent_monthly: data.sfrInPlaceRent || 0,
            target_rent_monthly: data.sfrTargetRent || 0,
            rental_type: (data.sfrRentalType ?? 'LTR') as 'LTR' | 'MTR' | 'STR',
          }];
      const result = await api.generateAssumptions({
        address: data.propertyAddress,
        purchase_price: data.purchasePrice,
        unit_mix,
      });
      onAssumptionsChange(result.assumptions);
      onCostChange(result.cost);

      // Bulk-sync AI market + in-place rents into acquisition.unitMix so the
      // downstream stabilized rent calc (DealAnalyzerForm's grossRent sync
      // effect) sees the AI's values. Without this, the AssumptionsEditor
      // would display AI rents but acquisition.unitMix stays at 0 → the
      // Operations step warning fires + Calculate button is blocked.
      const rentBlock = (result.assumptions?.market_rent_estimation ?? {}) as Record<string, unknown>;
      const byUnitType = ((rentBlock.by_unit_type as unknown[]) ?? []) as AiRentEntry[];
      if (data.propertyType === 'mfr' && data.unitMix?.length && byUnitType.length > 0) {
        // Match AI row → unitMix rows by beds+baths (not by index). Two
        // unitMix rows of "1BR/1BA" both get the same AI rent applied.
        const nextUnitMix = data.unitMix.map((u) => {
          const entry = findAiRentForUnit(byUnitType, u.beds, u.baths);
          if (!entry) return u;
          const inPlace = entry.estimated_in_place_rent_monthly;
          const target  = entry.estimated_market_rent_monthly;
          return {
            ...u,
            ...(inPlace != null && inPlace > 0 ? { inPlaceRent: Math.round(inPlace) } : {}),
            ...(target  != null && target  > 0 ? { rentMonthly: Math.round(target)  } : {}),
          };
        });
        onChange('unitMix', nextUnitMix);
      } else if (data.propertyType === 'sfr' && byUnitType[0]) {
        const entry = byUnitType[0];
        if ((entry.estimated_in_place_rent_monthly ?? 0) > 0) {
          onChange('sfrInPlaceRent', Math.round(entry.estimated_in_place_rent_monthly!));
        }
        if ((entry.estimated_market_rent_monthly ?? 0) > 0) {
          onChange('sfrTargetRent', Math.round(entry.estimated_market_rent_monthly!));
        }
      }

      // Bulk sync all AI operating expenses into pf.expenses. Fresh AI response
      // → overwrite mode so all values reflect what the AI just returned.
      const { ltrEgi, mtrEgi } = computePerStrategyEgi(result.assumptions);
      onProFormaChange(bulkSyncAiOpexToProForma(
        proForma, result.assumptions, proForma.grossRent.stabilized,
        expenseGrowthPct, insuranceGrowthPct, ltrEgi, mtrEgi, 'overwrite',
      ));
    } catch (err) {
      setAiError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setAiLoading(false);
    }
  }

  // Auto-fire ONCE for new deals when the required inputs are present.
  // Existing deals must use the manual "Regenerate with AI" button so we
  // don't burn AI cost on every reopen.
  useEffect(() => {
    if (!isNewDeal || autoFireRef.current || assumptions) return;
    if (!canGenerate) return;
    autoFireRef.current = true;
    runAi();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isNewDeal, canGenerate]);

  // On mount for existing deals: fill in any AI operating-expense categories
  // that aren't present in pf.expenses yet. `fillMissing` mode preserves user
  // edits — only adds categories the pro-forma doesn't already know about.
  // Runs once when assumptions first become available.
  //
  // Also backfills AI market/in-place rents into acquisition.unitMix when a
  // unit type has AI rent data but the persisted unitMix entry is still 0 —
  // legacy deals from before the rent-sync was added to runAi. This makes the
  // Operations step's grossRent.stabilized sync see the correct values so the
  // "no target rent" warning doesn't misfire.
  const hydratedFromAssumptionsRef = useRef(false);
  useEffect(() => {
    if (hydratedFromAssumptionsRef.current) return;
    if (!assumptions || isNewDeal) return; // new-deal path runs bulk-sync via runAi
    hydratedFromAssumptionsRef.current = true;

    // 1) OpEx fill-missing (existing behavior)
    const { ltrEgi, mtrEgi } = computePerStrategyEgi(assumptions);
    onProFormaChange(bulkSyncAiOpexToProForma(
      proForma, assumptions, proForma.grossRent.stabilized,
      expenseGrowthPct, insuranceGrowthPct, ltrEgi, mtrEgi, 'fillMissing',
    ));

    // 2) Rent backfill — only fill unitMix entries that are still at 0.
    // Preserves any user overrides (non-zero) already in unitMix.
    const rentBlock = (assumptions.market_rent_estimation ?? {}) as Record<string, unknown>;
    const byUnitType = ((rentBlock.by_unit_type as unknown[]) ?? []) as AiRentEntry[];
    if (data.propertyType === 'mfr' && data.unitMix?.length && byUnitType.length > 0) {
      let changed = false;
      // Match AI row → unitMix rows by beds+baths (not by index) so
      // duplicate unitMix rows (e.g. two 1BR/1BA rows for a split-tenancy
      // model) both get the AI rent applied.
      const nextUnitMix = data.unitMix.map((u) => {
        const entry = findAiRentForUnit(byUnitType, u.beds, u.baths);
        if (!entry) return u;
        const aiInPlace = entry.estimated_in_place_rent_monthly;
        const aiTarget  = entry.estimated_market_rent_monthly;
        const patch: Partial<typeof u> = {};
        if ((u.inPlaceRent || 0) === 0 && aiInPlace != null && aiInPlace > 0) {
          patch.inPlaceRent = Math.round(aiInPlace);
          changed = true;
        }
        if ((u.rentMonthly || 0) === 0 && aiTarget != null && aiTarget > 0) {
          patch.rentMonthly = Math.round(aiTarget);
          changed = true;
        }
        return Object.keys(patch).length > 0 ? { ...u, ...patch } : u;
      });
      if (changed) onChange('unitMix', nextUnitMix);
    } else if (data.propertyType === 'sfr' && byUnitType[0]) {
      const entry = byUnitType[0];
      if ((data.sfrInPlaceRent || 0) === 0 && (entry.estimated_in_place_rent_monthly ?? 0) > 0) {
        onChange('sfrInPlaceRent', Math.round(entry.estimated_in_place_rent_monthly!));
      }
      if ((data.sfrTargetRent || 0) === 0 && (entry.estimated_market_rent_monthly ?? 0) > 0) {
        onChange('sfrTargetRent', Math.round(entry.estimated_market_rent_monthly!));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assumptions, isNewDeal]);

  // Keep `aiAssumptions.market_rent_estimation.by_unit_type` structure aligned
  // with the current `data.unitMix` — specifically `count`, `unit_type`, and
  // the list of rows itself. Rent estimation values (in-place / market) are
  // PRESERVED by matching existing entries on beds+baths.
  //
  // Why this exists: AI's response captures a snapshot of unit-mix at AI-run
  // time. If the user later edits unit-mix count in Step 2 (e.g. 1 → 2 units),
  // the projector uses the new count for calculations but the Rent Info
  // table displays the stale AI count. Same for beds/baths edits.
  //
  // This sync runs on every unit-mix change but is a no-op when values
  // already match (early return via JSON-compare avoids infinite loop).
  useEffect(() => {
    if (data.propertyType !== 'mfr' || !data.unitMix?.length) return;
    if (!assumptions) return; // nothing to sync yet — AI hasn't run
    const rentBlock = (assumptions.market_rent_estimation ?? {}) as Record<string, unknown>;
    const existingByUnit = ((rentBlock.by_unit_type as unknown[]) ?? []) as AiRentEntry[];

    // Rebuild the by_unit_type array from unitMix, preserving rent values
    // from any matching existing entry.
    const nextByUnit = data.unitMix.map((u) => {
      const match = findAiRentForUnit(existingByUnit, u.beds, u.baths);
      return {
        unit_type: `${u.beds}BR/${u.baths}BA`,
        count: u.count,
        estimated_in_place_rent_monthly: match?.estimated_in_place_rent_monthly ?? u.inPlaceRent ?? 0,
        estimated_market_rent_monthly:  match?.estimated_market_rent_monthly  ?? u.rentMonthly  ?? 0,
        // Preserve any additional fields from the matched entry (source,
        // confidence, etc.) so the "conf" badge and source URLs survive.
        ...(match ? Object.fromEntries(
          Object.entries(match).filter(([k]) =>
            !['unit_type', 'count', 'estimated_in_place_rent_monthly', 'estimated_market_rent_monthly'].includes(k)
          )
        ) : {}),
      };
    });

    // No-op guard — if the array already matches (structure + values), skip
    // the update to avoid an infinite render loop.
    if (JSON.stringify(existingByUnit) === JSON.stringify(nextByUnit)) return;

    onAssumptionsChange({
      ...(assumptions ?? {}),
      market_rent_estimation: { ...rentBlock, by_unit_type: nextByUnit },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.unitMix, data.propertyType]);

  return (
    <div className="space-y-6">

      {/* ── Loan & Hold ─────────────────────────────────────────────────── */}
      <section>
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 pt-1 pb-2 -mx-1 px-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-primary-700 dark:text-primary-400">Loan &amp; Hold</h3>
        </div>

        <Input
          label="Purchase Price ($)"
          type="number"
          fullWidth min={0}
          placeholder="e.g. 350,000"
          value={data.purchasePrice || ''}
          onChange={(e) => onChange('purchasePrice', Number(e.target.value))}
          warning={warn('purchasePrice')}
        />

        <div className="mt-4">
          <Input
            label="Down Payment (%)"
            type="number"
            fullWidth min={0} max={100} step={0.5}
            placeholder="e.g. 25"
            value={data.downPaymentPct ?? ''}
            onChange={(e) => onChange('downPaymentPct', Number(e.target.value))}
            helperText={data.purchasePrice > 0 && data.downPaymentPct > 0
              ? `= $${Math.round(data.purchasePrice * data.downPaymentPct / 100).toLocaleString()}${isCash ? ' — Cash purchase' : ''}`
              : '% of purchase price (enter 100 for all-cash)'}
            warning={warn('downPaymentPct')}
          />
        </div>

        {!isCash && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <Input
                label="Closing Costs (%)"
                type="number"
                fullWidth min={0} max={10} step={0.1}
                placeholder="e.g. 3"
                value={data.closingCostsPct ?? ''}
                onChange={(e) => onChange('closingCostsPct', Number(e.target.value))}
                helperText={data.purchasePrice > 0 && data.closingCostsPct > 0
                  ? `= $${Math.round(data.purchasePrice * data.closingCostsPct / 100).toLocaleString()}`
                  : '% of purchase price'}
                warning={warn('closingCostsPct')}
              />
              <Input
                label="Loan Points"
                type="number"
                fullWidth min={0} max={10} step={0.25}
                placeholder="e.g. 1"
                value={data.points ?? ''}
                onChange={(e) => onChange('points', Number(e.target.value))}
                helperText="1 point = 1% of loan"
                warning={warn('points')}
              />
            </div>

            <div className="mt-4">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
                Additional Fees
                <span className="ml-1.5 text-xs font-normal text-slate-400">(origination, appraisal, title, etc.)</span>
              </p>
              <CostItemList
                items={data.additionalFeeItems ?? []}
                placeholder="e.g. Appraisal, Title Insurance…"
                addLabel="Add fee"
                showWarnings={missingFields !== undefined}
                onAdd={(description) => onChange('additionalFeeItems', [...(data.additionalFeeItems ?? []), { ...newItem(), description }])}
                onUpdate={(id, field, value) =>
                  onChange('additionalFeeItems', (data.additionalFeeItems ?? []).map(item => item.id === id ? { ...item, [field]: value } : item))
                }
                onRemove={(id) =>
                  onChange('additionalFeeItems', (data.additionalFeeItems ?? []).filter(item => item.id !== id))
                }
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
              <div>
                {data.marketRateAtCreation && (
                  <p className="mb-1 text-xs text-slate-500 dark:text-slate-400">
                    Today&apos;s 30-yr fixed rate (FRED, as of {formatAsOf(data.marketRateAtCreation.asOf)}):{' '}
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      {data.marketRateAtCreation.rate.toFixed(2)}%
                    </span>{' '}
                    — auto-filled with +0.5% investment premium
                  </p>
                )}
                <Input
                  label="Interest Rate (%)"
                  type="number"
                  fullWidth min={0} max={30} step={0.125}
                  placeholder="e.g. 7.0"
                  value={data.interestRate || ''}
                  onChange={(e) => onChange('interestRate', Number(e.target.value))}
                  warning={warn('interestRate')}
                />
              </div>
              <Input
                label="Loan Term (years)"
                type="number"
                fullWidth min={1} max={40}
                placeholder="e.g. 30"
                value={data.loanTermYears || ''}
                onChange={(e) => onChange('loanTermYears', Number(e.target.value))}
                warning={warn('loanTermYears')}
              />
            </div>

            <div className="mt-4">
              <Input
                label="Interest-Only Period (months)"
                type="number"
                fullWidth min={0}
                placeholder="0"
                value={data.ioPeriodMonths ?? ''}
                onChange={(e) => onChange('ioPeriodMonths', Number(e.target.value))}
                helperText="Leave 0 for a fully amortizing loan"
              />
            </div>
          </>
        )}

        <div className="mt-4 max-w-xs">
          <Input
            label="Hold Period (years)"
            type="number"
            fullWidth min={1} max={30}
            placeholder="5"
            value={data.projectionYears || ''}
            onChange={(e) => onChange('projectionYears', Number(e.target.value))}
            helperText="How many years to model (1–30)"
          />
        </div>
      </section>

      {/* ── Growth ──────────────────────────────────────────────────────── */}
      <section>
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 pt-1 pb-2 -mx-1 px-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-primary-700 dark:text-primary-400">Growth</h3>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input
            label="Income Growth (%/yr)" type="number" fullWidth step={0.1} min={0}
            value={incomeGrowthPct}
            onChange={(e) => setIncomeGrowthPct(Number(e.target.value))}
            helperText="Applied to gross rent + other income"
          />
          <Input
            label="Expense Growth (%/yr)" type="number" fullWidth step={0.1} min={0}
            value={expenseGrowthPct}
            onChange={(e) => setExpenseGrowthPct(Number(e.target.value))}
            helperText="Default for OpEx line items"
          />
          <Input
            label="Insurance Growth (%/yr)" type="number" fullWidth step={0.1} min={0}
            value={insuranceGrowthPct}
            onChange={(e) => setInsuranceGrowthPct(Number(e.target.value))}
            helperText="Overrides expense growth for insurance"
          />
        </div>
      </section>

      {/* ── Vacancy & Collections ───────────────────────────────────────── */}
      <section>
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 pt-1 pb-2 -mx-1 px-1">
          <h3 className="text-xs font-bold uppercase tracking-wider text-primary-700 dark:text-primary-400">Vacancy &amp; Collections</h3>
        </div>

        {/* Per-year vacancy — one input per hold-period year. Editing a year
            cascades that value forward to all subsequent years. Hidden when
            the deal has no LTR units (MTR/STR-only) since the projector never
            applies the LTR rate. */}
        {hasLtr && (
          <div className="mb-4">
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
              {hasMtrOrStr ? 'LTR Vacancy (% by year)' : 'Vacancy (% by year)'}
            </label>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {Array.from({ length: data.projectionYears || 5 }, (_, i) => (
                      <th key={i} className="text-center py-1 px-1 font-medium">Yr {i + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {Array.from({ length: data.projectionYears || 5 }, (_, i) => {
                      const year = i + 1;
                      const val = getYearVacancy(year);
                      return (
                        <td key={year} className="px-1 py-1">
                          <input
                            type="number" step={0.1} min={0} max={100}
                            value={val}
                            onChange={(e) => setYearVacancy(year, Number(e.target.value))}
                            className="w-full px-2 py-1.5 text-sm text-right tabular-nums border rounded bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                          />
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Editing a year cascades its value forward.
            </p>
          </div>
        )}

        {/* MTR-specific vacancy — only when the deal has MTR/STR units. Drops
            the "MTR" prefix + border when the deal is MTR-only (no LTR to
            distinguish from). */}
        {hasMtrOrStr && (
          <div className={hasLtr ? "mb-4 border-t-2 border-primary-500 pt-3" : "mb-4"}>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
              {hasLtr ? 'MTR / STR Vacancy (% by year)' : 'Vacancy (% by year)'}
              {hasLtr && (
                <span className="ml-1.5 text-[10px] text-primary-600 dark:text-primary-400 font-semibold uppercase">MTR</span>
              )}
            </label>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {Array.from({ length: data.projectionYears || 5 }, (_, i) => (
                      <th key={i} className="text-center py-1 px-1 font-medium">Yr {i + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {Array.from({ length: data.projectionYears || 5 }, (_, i) => {
                      const year = i + 1;
                      return (
                        <td key={year} className="px-1 py-1">
                          <input
                            type="number" step={0.1} min={0} max={100}
                            value={getYearMtrVacancy(year)}
                            onChange={(e) => setYearMtrVacancy(year, Number(e.target.value) || 0)}
                            className="w-full px-2 py-1.5 text-sm text-right tabular-nums border rounded bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                          />
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              MTR/STR units typically run 15-30% vacancy vs 5-10% for LTR. Defaults to 20%. Editing a year cascades forward.
            </p>

            {/* MTR-specific bad debt / concessions */}
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mt-4 mb-2">
              {hasLtr ? 'MTR / STR Bad Debt / Concessions (% by year)' : 'Bad Debt / Concessions (% by year)'}
              {hasLtr && (
                <span className="ml-1.5 text-[10px] text-primary-600 dark:text-primary-400 font-semibold uppercase">MTR</span>
              )}
            </label>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {Array.from({ length: data.projectionYears || 5 }, (_, i) => (
                      <th key={i} className="text-center py-1 px-1 font-medium">Yr {i + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {Array.from({ length: data.projectionYears || 5 }, (_, i) => {
                      const year = i + 1;
                      return (
                        <td key={year} className="px-1 py-1">
                          <input
                            type="number" step={0.1} min={0} max={100}
                            value={getYearMtrBadDebt(year)}
                            onChange={(e) => setYearMtrBadDebt(year, Number(e.target.value) || 0)}
                            className="w-full px-2 py-1.5 text-sm text-right tabular-nums border rounded bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                          />
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Defaults to 2% (same as LTR). Editing a year cascades forward.
            </p>
          </div>
        )}

        {/* Per-year bad debt / concessions — same cascade behavior. Hidden
            when the deal has no LTR units (MTR/STR-only). */}
        {hasLtr && (
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">
              {hasMtrOrStr ? 'LTR Bad Debt / Concessions (% by year)' : 'Bad Debt / Concessions (% by year)'}
            </label>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    {Array.from({ length: data.projectionYears || 5 }, (_, i) => (
                      <th key={i} className="text-center py-1 px-1 font-medium">Yr {i + 1}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    {Array.from({ length: data.projectionYears || 5 }, (_, i) => {
                      const year = i + 1;
                      const val = getYearBadDebt(year);
                      return (
                        <td key={year} className="px-1 py-1">
                          <input
                            type="number" step={0.1} min={0} max={100}
                            value={val}
                            onChange={(e) => setYearBadDebt(year, Number(e.target.value))}
                            className="w-full px-2 py-1.5 text-sm text-right tabular-nums border rounded bg-white dark:bg-slate-800 border-slate-300 dark:border-slate-600"
                          />
                        </td>
                      );
                    })}
                  </tr>
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              % of gross potential rent lost to uncollected rent + concessions. Editing a year cascades forward.
            </p>
          </div>
        )}
      </section>

      {/* ── AI Market Assumptions ───────────────────────────────────────── */}
      <section>
        <div className="sticky top-0 z-10 bg-white dark:bg-slate-900 pt-1 pb-2 -mx-1 px-1 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-primary-700 dark:text-primary-400">Market Assumptions (AI)</h3>
          <button
            type="button"
            onClick={runAi}
            disabled={aiLoading || !canGenerate}
            className="text-xs px-3 py-1.5 rounded-md border border-primary-300 dark:border-primary-700 text-primary-700 dark:text-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 disabled:opacity-60"
          >
            {aiLoading ? 'Regenerating…' : assumptions ? 'Regenerate with AI' : 'Generate with AI'}
          </button>
        </div>

        {!canGenerate && !aiLoading && (
          <div className="p-4 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md text-sm text-amber-800 dark:text-amber-300">
            Enter {missingForAi.join(' and ')} to enable AI market assumptions
            {missingForAi.length === 1 && missingForAi[0] === 'purchase price' ? ' (will auto-fire the moment you enter it).' : '.'}
          </div>
        )}

        {aiLoading && (
          <div className="p-6 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-md">
            <div className="flex items-start gap-3">
              <Loader2 className="w-5 h-5 text-primary-500 animate-spin shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">Assessing market data…</p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Pulling comps for your Census Tract, county tax data, insurance benchmarks, and rental listings.
                  This takes 10–30 seconds. We&apos;ll show you cap rate, rent, and OpEx estimates when it&apos;s ready.
                </p>
              </div>
            </div>
          </div>
        )}

        {aiError && !aiLoading && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-sm text-red-700 dark:text-red-300">
            {aiError}
          </div>
        )}

        {assumptions && !aiLoading && (
          <>
            {cost && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
                AI call cost: Serper ${cost.serper_usd.toFixed(4)} ({cost.serper_search_count} fresh) · Gemini ${cost.gemini_usd.toFixed(4)} · Total ${cost.total_usd.toFixed(4)}
              </p>
            )}
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3">
              Unit count breakdown: <span className="font-mono">{unitCount} total</span>
              {' · '}<span className="font-mono">{ltrUnitCount} LTR</span>
              {' · '}<span className="font-mono">{mtrUnitCount} MTR/STR</span>
              {' — '}per-section per-unit denominators use these counts.
            </p>
            <AssumptionsEditor
              raw={assumptions as never}
              unitCount={unitCount}
              ltrUnitCount={ltrUnitCount}
              mtrUnitCount={mtrUnitCount}
              rentalTypes={
                data.propertyType === 'mfr' && data.unitMix?.length
                  ? data.unitMix.map((u) => u.rentalType ?? 'LTR')
                  : [data.sfrRentalType ?? 'LTR']
              }
              onOpexChange={(category, annual) => {
                // 1) Sync into proForma (drives projection math + auto-save)
                const egiEstimate = proForma.grossRent.stabilized;
                // Per-strategy EGI so the % stored for PM/R&M (LTR/MTR) is
                // anchored on the strategy-specific rent base, matching how
                // the projector splits revenue in `getEGIByStrategy`.
                const rentBlock = (assumptions?.market_rent_estimation ?? {}) as Record<string, unknown>;
                const byUnitType = ((rentBlock.by_unit_type as unknown[]) ?? []) as Array<{
                  count?: number;
                  estimated_in_place_rent_monthly?: number | null;
                  estimated_market_rent_monthly?: number | null;
                }>;
                const rentalTypesForCalc = data.propertyType === 'mfr' && data.unitMix?.length
                  ? data.unitMix.map((u) => u.rentalType ?? 'LTR')
                  : [data.sfrRentalType ?? 'LTR'];
                let ltrEgi = 0;
                let mtrEgi = 0;
                byUnitType.forEach((entry, i) => {
                  const monthly = entry.estimated_in_place_rent_monthly ?? entry.estimated_market_rent_monthly ?? 0;
                  const annualForUnit = (monthly || 0) * (entry.count || 0) * 12;
                  const t = rentalTypesForCalc[i] ?? 'LTR';
                  if (t === 'MTR' || t === 'STR') mtrEgi += annualForUnit;
                  else ltrEgi += annualForUnit;
                });
                onProFormaChange(syncOpexToProForma(
                  proForma, category, annual, egiEstimate,
                  expenseGrowthPct, insuranceGrowthPct,
                  ltrEgi, mtrEgi,
                ));
                // 2) Patch aiAssumptions so the persisted snapshot matches
                //    what the user sees on reload.
                const prevOps = (assumptions?.operating_expenses ?? {}) as Record<string, unknown>;
                const prevItem = (prevOps[category] ?? {}) as Record<string, unknown>;
                onAssumptionsChange({
                  ...(assumptions ?? {}),
                  operating_expenses: {
                    ...prevOps,
                    [category]: { ...prevItem, annual },
                  },
                });
              }}
              onRentChange={(unitTypeIndex, field, monthly) => {
                // 1) Sync into acquisition unitMix / SFR fields
                if (data.propertyType === 'mfr' && data.unitMix?.length) {
                  const nextUnitMix = data.unitMix.map((u, i) =>
                    i === unitTypeIndex
                      ? { ...u, [field === 'in_place' ? 'inPlaceRent' : 'rentMonthly']: monthly }
                      : u
                  );
                  onChange('unitMix', nextUnitMix);
                } else {
                  onChange(field === 'in_place' ? 'sfrInPlaceRent' : 'sfrTargetRent', monthly);
                }
                // 2) Patch aiAssumptions.market_rent_estimation.by_unit_type[i]
                const rentBlock = (assumptions?.market_rent_estimation ?? {}) as Record<string, unknown>;
                const byUnitType = ((rentBlock.by_unit_type as unknown[]) ?? []) as Record<string, unknown>[];
                const nextByUnit = byUnitType.map((entry, i) =>
                  i === unitTypeIndex
                    ? {
                        ...entry,
                        [field === 'in_place' ? 'estimated_in_place_rent_monthly' : 'estimated_market_rent_monthly']: monthly,
                      }
                    : entry
                );
                onAssumptionsChange({
                  ...(assumptions ?? {}),
                  market_rent_estimation: { ...rentBlock, by_unit_type: nextByUnit },
                });
              }}
              onCapRateChange={(field, pct) => {
                // Cap rate lives only in aiAssumptions (not in proForma). This
                // handler fires TWICE back-to-back when the user edits entry
                // cap (once for entry, once for auto-updated exit). Using the
                // closure-captured `assumptions` value would cause the second
                // call to overwrite the first (stale-closure bug). Read via
                // functional setter so each call sees the latest state.
                //
                // The parent setter is React's setAiAssumptions which accepts
                // either a value or a (prev) => next callback. We pass a
                // callback via an unchecked cast so callers of onAssumptionsChange
                // can still use the simple value form when they prefer.
                (onAssumptionsChange as unknown as (
                  updater: (prev: Record<string, unknown> | null) => Record<string, unknown> | null
                ) => void)((prev) => {
                  const prevCap = (prev?.cap_rate_estimation ?? {}) as Record<string, unknown>;
                  return {
                    ...(prev ?? {}),
                    cap_rate_estimation: {
                      ...prevCap,
                      [field === 'entry' ? 'current_market_cap_rate_pct' : 'exit_cap_rate_pct']: pct,
                    },
                  };
                });
                if (field === 'exit') {
                  onChange('exitCapRate', pct);
                }
              }}
            />
          </>
        )}
      </section>
    </div>
  );
}
