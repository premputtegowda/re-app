'use client';

import { useEffect, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { AssumptionsEditor } from '@/components/DealAnalyzer/AssumptionsEditor';

interface CategoryCost {
  category: string;
  submarket_key: string | null;
  cache_hit: boolean;
  searches_run: number;
  cost_usd: number;
}

interface CostBreakdown {
  serper_usd: number;
  serper_search_count: number;
  gemini_usd: number;
  gemini_input_tokens: number;
  gemini_output_tokens: number;
  total_usd: number;
  by_category: CategoryCost[];
}

interface Submarket {
  census_tract: string;
  county_fips: string;
  matched_address: string;
}

interface UnitMixRow {
  beds: number;
  baths: number;
  count: number;
  in_place_rent_monthly: number;
  target_rent_monthly: number;
}

const DEFAULT_UNIT_MIX: UnitMixRow[] = [
  { beds: 2, baths: 1, count: 4, in_place_rent_monthly: 900, target_rent_monthly: 1200 },
];

export default function AssumptionsTestPage() {
  const [address, setAddress] = useState('8722 Messiah Drive, Newburgh, Indiana 47630');
  const [purchasePrice, setPurchasePrice] = useState<number>(500000);
  const [unitMix, setUnitMix] = useState<UnitMixRow[]>(DEFAULT_UNIT_MIX);
  const [nrsf, setNrsf] = useState<string>('');
  // Financing assumptions
  const [downPaymentPct, setDownPaymentPct] = useState<number>(25);
  const [closingCostsPct, setClosingCostsPct] = useState<number>(3);
  const [interestRatePct, setInterestRatePct] = useState<number>(0);
  const [holdPeriodYears, setHoldPeriodYears] = useState<number>(5);
  const [rateSource, setRateSource] = useState<string>('');
  // Growth assumptions (annual, applied to pro-forma projection)
  const [incomeGrowthPct, setIncomeGrowthPct] = useState<number>(2);
  const [expenseGrowthPct, setExpenseGrowthPct] = useState<number>(2);
  const [insuranceGrowthPct, setInsuranceGrowthPct] = useState<number>(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cost, setCost] = useState<CostBreakdown | null>(null);
  const [submarket, setSubmarket] = useState<Submarket | null>(null);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [assumptions, setAssumptions] = useState<Record<string, unknown> | null>(null);

  const totalUnits = unitMix.reduce((s, u) => s + u.count, 0);
  const derivedGpr = unitMix.reduce(
    (s, u) => s + u.count * (u.target_rent_monthly || u.in_place_rent_monthly) * 12,
    0
  );

  // Fetch FRED rate on mount → default interest rate to FRED + 0.5% investment premium.
  // Matches the same defaulting logic used in the wizard's Financing step.
  useEffect(() => {
    let cancelled = false;
    api.getMortgageRate().then((snap) => {
      if (cancelled || !snap) return;
      const suggested = Number((snap.rate + 0.5).toFixed(3));
      setInterestRatePct((prev) => (prev > 0 ? prev : suggested));
      setRateSource(`FRED ${snap.series} ${snap.rate.toFixed(2)}% as of ${snap.asOf} + 0.5% investment premium`);
    });
    return () => { cancelled = true; };
  }, []);

  function updateUnitRow(i: number, patch: Partial<UnitMixRow>) {
    setUnitMix((prev) => prev.map((row, idx) => (idx === i ? { ...row, ...patch } : row)));
  }

  function addUnitRow() {
    setUnitMix((prev) => [...prev, { beds: 1, baths: 1, count: 1, in_place_rent_monthly: 0, target_rent_monthly: 0 }]);
  }

  function removeUnitRow(i: number) {
    setUnitMix((prev) => prev.filter((_, idx) => idx !== i));
  }

  async function handleGenerate() {
    setLoading(true);
    setError(null);
    setAssumptions(null);
    setCost(null);
    try {
      const result = await api.generateAssumptions({
        address,
        purchase_price: purchasePrice,
        unit_mix: unitMix,
        nrsf: nrsf ? Number(nrsf) : undefined,
      });
      setCost(result.cost);
      setSubmarket(result.submarket);
      setSessionTotal((prev) => prev + result.cost.total_usd);
      setAssumptions(result.assumptions);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Cost banner — always visible at top */}
      <div className="sticky top-0 z-10 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between text-sm gap-2">
          <div className="flex flex-wrap items-center gap-4">
            <span className="font-semibold text-slate-800 dark:text-slate-200">AI Cost</span>
            {cost ? (
              <>
                <span className="text-slate-600 dark:text-slate-300">
                  Serper: <span className="font-mono">${cost.serper_usd.toFixed(4)}</span>
                  <span className="text-slate-400"> ({cost.serper_search_count} searches)</span>
                </span>
                <span className="text-slate-600 dark:text-slate-300">
                  Gemini: <span className="font-mono">${cost.gemini_usd.toFixed(4)}</span>
                  <span className="text-slate-400"> ({cost.gemini_input_tokens.toLocaleString()} in / {cost.gemini_output_tokens.toLocaleString()} out)</span>
                </span>
                <span className="font-semibold text-primary-600 dark:text-primary-400">
                  This call: <span className="font-mono">${cost.total_usd.toFixed(4)}</span>
                </span>
              </>
            ) : (
              <span className="text-slate-400">No call yet</span>
            )}
          </div>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Session total: <span className="font-mono font-semibold">${sessionTotal.toFixed(4)}</span>
          </span>
        </div>
        {submarket && (
          <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
            Submarket: Tract <span className="font-mono">{submarket.census_tract}</span> · County <span className="font-mono">{submarket.county_fips}</span>
          </p>
        )}
        {cost && cost.by_category.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {cost.by_category.map((c) => (
              <span
                key={c.category}
                className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded ${
                  c.cache_hit
                    ? 'bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800'
                    : 'bg-slate-100 text-slate-600 border border-slate-200 dark:bg-slate-700 dark:text-slate-300 dark:border-slate-600'
                }`}
                title={c.cache_hit ? 'Cached — $0' : `Fresh: $${c.cost_usd.toFixed(4)}`}
              >
                {c.cache_hit ? '✓' : '↻'} {c.category.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}
      </div>

      <div>
        <h1 className="text-xl font-bold text-slate-800 dark:text-slate-200">AI Assumptions — Test Panel</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
          Inputs mirror what the Property + Finance wizard steps capture (address, unit mix, purchase price).
        </p>
      </div>

      {/* Address + Purchase Price */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="sm:col-span-2">
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Address</label>
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Purchase Price ($)</label>
          <input
            type="number"
            value={purchasePrice}
            onChange={(e) => setPurchasePrice(Number(e.target.value))}
            min={1}
            className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
          />
        </div>
      </div>

      {/* Unit mix */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <label className="text-xs font-medium text-slate-600 dark:text-slate-400">Unit Mix</label>
          <button
            type="button"
            onClick={addUnitRow}
            className="flex items-center gap-1 text-xs text-primary-600 hover:text-primary-700"
          >
            <Plus size={12} /> Add unit type
          </button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[10px] uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700">
                <th className="pb-2 pr-2">Beds</th>
                <th className="pb-2 pr-2">Baths</th>
                <th className="pb-2 pr-2">Count</th>
                <th className="pb-2 pr-2">In-Place $/mo</th>
                <th className="pb-2 pr-2">Target $/mo</th>
                <th className="pb-2"></th>
              </tr>
            </thead>
            <tbody>
              {unitMix.map((u, i) => (
                <tr key={i} className="border-b border-slate-100 dark:border-slate-800">
                  <td className="py-1.5 pr-2">
                    <input type="number" value={u.beds} onChange={(e) => updateUnitRow(i, { beds: Number(e.target.value) })}
                      className="w-16 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800" />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input type="number" step={0.5} value={u.baths} onChange={(e) => updateUnitRow(i, { baths: Number(e.target.value) })}
                      className="w-16 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800" />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input type="number" value={u.count} onChange={(e) => updateUnitRow(i, { count: Number(e.target.value) })}
                      className="w-20 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800" />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input type="number" value={u.in_place_rent_monthly} onChange={(e) => updateUnitRow(i, { in_place_rent_monthly: Number(e.target.value) })}
                      className="w-28 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800" />
                  </td>
                  <td className="py-1.5 pr-2">
                    <input type="number" value={u.target_rent_monthly} onChange={(e) => updateUnitRow(i, { target_rent_monthly: Number(e.target.value) })}
                      className="w-28 px-2 py-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800" />
                  </td>
                  <td className="py-1.5">
                    {unitMix.length > 1 && (
                      <button type="button" onClick={() => removeUnitRow(i)} className="text-slate-400 hover:text-red-500">
                        <X size={14} />
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
          Total units: <span className="font-semibold">{totalUnits}</span> · Derived GPR (annual):{' '}
          <span className="font-semibold font-mono">${derivedGpr.toLocaleString()}</span>
        </p>
      </div>

      {/* Optional NRSF */}
      <div className="max-w-xs">
        <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
          NRSF (optional — enables per-SF metrics)
        </label>
        <input
          type="number"
          value={nrsf}
          onChange={(e) => setNrsf(e.target.value)}
          placeholder="e.g. 4800"
          className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
        />
      </div>

      {/* Financing Assumptions */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-800/50">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">Financing Assumptions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Down Payment (%)</label>
            <input
              type="number"
              step={0.5}
              min={0}
              max={100}
              value={downPaymentPct}
              onChange={(e) => setDownPaymentPct(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Loan amount: ${(purchasePrice * (1 - downPaymentPct / 100)).toLocaleString('en-US', { maximumFractionDigits: 0 })}
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Closing Costs (%)</label>
            <input
              type="number"
              step={0.1}
              min={0}
              max={10}
              value={closingCostsPct}
              onChange={(e) => setClosingCostsPct(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              ${(purchasePrice * (closingCostsPct / 100)).toLocaleString('en-US', { maximumFractionDigits: 0 })} of purchase price
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Interest Rate (%)</label>
            <input
              type="number"
              step={0.125}
              min={0}
              value={interestRatePct}
              onChange={(e) => setInterestRatePct(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
            />
            {rateSource && (
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">{rateSource}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Hold Period (years)</label>
            <input
              type="number"
              min={1}
              max={30}
              value={holdPeriodYears}
              onChange={(e) => setHoldPeriodYears(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Projection horizon for underwriting
            </p>
          </div>
        </div>
      </div>

      {/* Growth Assumptions */}
      <div className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-800/50">
        <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-200 mb-3">Growth Assumptions</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Income Growth (% / yr)</label>
            <input
              type="number" step={0.1} min={0}
              value={incomeGrowthPct}
              onChange={(e) => setIncomeGrowthPct(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Applied to gross rent + other income
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Expense Growth (% / yr)</label>
            <input
              type="number" step={0.1} min={0}
              value={expenseGrowthPct}
              onChange={(e) => setExpenseGrowthPct(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Default for all OpEx line items
            </p>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">Insurance Growth (% / yr)</label>
            <input
              type="number" step={0.1} min={0}
              value={insuranceGrowthPct}
              onChange={(e) => setInsuranceGrowthPct(Number(e.target.value))}
              className="w-full px-3 py-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 text-sm"
            />
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              Overrides expense growth for insurance line
            </p>
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={handleGenerate}
        disabled={loading || !address || totalUnits < 1 || purchasePrice < 1}
        className="px-5 py-2.5 bg-primary-600 hover:bg-primary-700 text-white rounded-md text-sm font-medium disabled:opacity-60"
      >
        {loading ? 'Generating… (may take 10-30s)' : 'Generate Assumptions'}
      </button>

      {error && (
        <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md text-sm text-red-700 dark:text-red-300">
          {error}
        </div>
      )}

      {assumptions && (
        <>
          <div className="pt-4 border-t border-slate-200 dark:border-slate-700">
            <h2 className="text-base font-semibold text-slate-800 dark:text-slate-200 mb-3">Assumptions (editable)</h2>
            <AssumptionsEditor raw={assumptions} unitCount={totalUnits} />
          </div>

          <details className="pt-4 border-t border-slate-200 dark:border-slate-700">
            <summary className="text-xs text-slate-500 dark:text-slate-400 cursor-pointer hover:text-slate-700 dark:hover:text-slate-300">
              Show raw JSON (debug)
            </summary>
            <pre className="mt-2 p-4 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-md text-xs overflow-x-auto max-h-[500px] overflow-y-auto">
              {JSON.stringify(assumptions, null, 2)}
            </pre>
          </details>
        </>
      )}
    </div>
  );
}
