'use client';

import { useEffect, useState } from 'react';
import { Lock, Pencil, RefreshCw, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { usePropertyTax } from '@/hooks/usePropertyTax';

// ── Props ─────────────────────────────────────────────────────────────────────

interface PropertyTaxEstimatorProps {
  address: string;
  purchasePrice: number;
  value: number;               // current proForma tax value (0 = not set)
  onChange: (value: number) => void;
  isManual: boolean;           // user has overridden the estimate
  onManualChange: (isManual: boolean) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * PropertyTaxEstimator
 *
 * A self-contained component for the Pro Forma Operations step.
 * Handles four UI states:
 *   1. Not fetched yet — "Estimate property tax" button
 *   2. Loading — spinner
 *   3. Success (locked) — estimated value with lock icon + Override link
 *   4. Manual — editable input with "Use estimate" re-fetch link
 *   5. Error — inline message + manual input fallback
 */
export function PropertyTaxEstimator({
  address,
  purchasePrice,
  value,
  onChange,
  isManual,
  onManualChange,
}: PropertyTaxEstimatorProps) {
  const { status, result, error, estimate } = usePropertyTax();
  const [breakdownOpen, setBreakdownOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState(value === 0 ? '' : String(value));

  const canAutoEstimate = !!address.trim() && purchasePrice > 0;

  // Auto-fetch when first rendered with valid address + price and no value set
  useEffect(() => {
    if (canAutoEstimate && value === 0 && !isManual && status === 'idle') {
      estimate(address, purchasePrice);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push Gemini result into the ProForma when estimation succeeds
  useEffect(() => {
    if (status === 'success' && result && !isManual) {
      onChange(Math.round(result.net_estimated_annual_tax / 12)); // convert annual → $/mo
    }
  }, [status, result, isManual, onChange]);

  // Keep manualDraft in sync when value is set externally (e.g. switching back)
  useEffect(() => {
    if (isManual && value > 0) {
      setManualDraft(String(value));
    }
  }, [isManual, value]);

  const handleEstimateClick = () => {
    if (!canAutoEstimate) return;
    estimate(address, purchasePrice);
  };

  const handleOverride = () => {
    onManualChange(true);
    setManualDraft(value === 0 ? '' : String(value));
  };

  const handleUseEstimate = () => {
    onManualChange(false);
    if (canAutoEstimate) {
      estimate(address, purchasePrice);
    }
  };

  const handleManualCommit = (raw: string) => {
    const parsed = parseFloat(raw.replace(/[$,\s]/g, ''));
    if (!isNaN(parsed) && parsed >= 0) {
      onChange(parsed);
    }
  };

  // ── Render: not yet fetched ──────────────────────────────────────────────

  if (status === 'idle' && value === 0 && !isManual) {
    return (
      <div className="flex items-center gap-2">
        <span className="text-sm text-slate-500 dark:text-slate-400">Property Taxes</span>
        <button
          type="button"
          onClick={handleEstimateClick}
          disabled={!canAutoEstimate}
          className="text-xs text-primary-600 dark:text-primary-400 hover:underline disabled:opacity-40 disabled:cursor-not-allowed"
        >
          Estimate property tax
        </button>
      </div>
    );
  }

  // ── Render: loading ──────────────────────────────────────────────────────

  if (status === 'loading') {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
        <RefreshCw size={13} className="animate-spin shrink-0" />
        <span>Estimating property tax…</span>
      </div>
    );
  }

  // ── Render: error ────────────────────────────────────────────────────────

  if (status === 'error' || (isManual && status !== 'success')) {
    return (
      <div className="space-y-1.5">
        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
          <AlertTriangle size={12} className="shrink-0" />
          <span>{error ?? 'Unable to retrieve tax info — please enter your own estimate'}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
            Property Taxes ($/mo)
          </label>
          <input
            type="number"
            className="input text-sm w-32 text-right"
            min={0}
            placeholder="0"
            value={manualDraft}
            onChange={(e) => setManualDraft(e.target.value)}
            onBlur={(e) => handleManualCommit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleManualCommit((e.target as HTMLInputElement).value);
            }}
          />
          {canAutoEstimate && (
            <button
              type="button"
              onClick={handleEstimateClick}
              className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap"
            >
              Retry estimate
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Render: manual override ──────────────────────────────────────────────

  if (isManual) {
    return (
      <div className="flex items-center gap-2">
        <label className="text-xs text-slate-500 dark:text-slate-400 whitespace-nowrap">
          Property Taxes ($/mo)
        </label>
        <input
          type="number"
          className="input text-sm w-32 text-right"
          min={0}
          placeholder="0"
          value={manualDraft}
          onChange={(e) => setManualDraft(e.target.value)}
          onBlur={(e) => handleManualCommit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleManualCommit((e.target as HTMLInputElement).value);
          }}
        />
        <button
          type="button"
          onClick={handleUseEstimate}
          className="text-xs text-primary-600 dark:text-primary-400 hover:underline whitespace-nowrap"
        >
          Use estimate
        </button>
      </div>
    );
  }

  // ── Render: success (locked) ─────────────────────────────────────────────

  const annualTax = result?.net_estimated_annual_tax ?? value * 12;
  const monthlyTax = Math.round(annualTax / 12);

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2">
        <Lock size={12} className="text-slate-400 dark:text-slate-500 shrink-0" />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Property Taxes
        </span>
        <span className="text-sm tabular-nums text-slate-800 dark:text-slate-200 ml-auto">
          {formatCurrency(monthlyTax)}/mo
          <span className="text-xs text-slate-400 dark:text-slate-500 ml-1">
            ({formatCurrency(annualTax)}/yr)
          </span>
        </span>
        <button
          type="button"
          onClick={handleOverride}
          className="text-xs text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 transition-colors flex items-center gap-0.5"
          title="Override estimate"
        >
          <Pencil size={10} />
          <span>Override</span>
        </button>
      </div>

      {result && (
        <>
          <button
            type="button"
            onClick={() => setBreakdownOpen((o) => !o)}
            className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 transition-colors ml-5"
          >
            {breakdownOpen ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
            <span>{breakdownOpen ? 'Hide' : 'Show'} breakdown</span>
          </button>

          {breakdownOpen && (
            <div className="ml-5 mt-1 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 space-y-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Tax Calculation — {result.regime_type.replace(/_/g, ' ')}
              </p>
              {result.calculation_breakdown.map((step, i) => (
                <p key={i} className="text-xs text-slate-600 dark:text-slate-400">
                  {step}
                </p>
              ))}
              {result.investor_penalties_applied.length > 0 && (
                <div className="pt-1 border-t border-slate-200 dark:border-slate-700">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-amber-500">
                    Investor adjustments
                  </p>
                  {result.investor_penalties_applied.map((p, i) => (
                    <p key={i} className="text-xs text-amber-600 dark:text-amber-400">
                      {p}
                    </p>
                  ))}
                </div>
              )}
              <p className="text-[10px] text-slate-400 dark:text-slate-500 pt-1 border-t border-slate-200 dark:border-slate-700">
                {result.effective_tax_rate_percentage.toFixed(2)}% effective rate ·{' '}
                {result.is_cached ? 'Cached' : 'Live'} · Refreshes {result.next_refresh_date}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
