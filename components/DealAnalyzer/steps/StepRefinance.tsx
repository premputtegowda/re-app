'use client';

import { Input } from '@/components/UI/Input';
import { Select } from '@/components/UI/Select';
import type { CoCRefinance } from '@/types';

interface StepRefinanceProps {
  data: CoCRefinance;
  arv: number;
  exitCapRate: number;
  projectionYears: number;
  onChange: (field: keyof CoCRefinance, value: number | boolean) => void;
  onArvChange: (value: number) => void;
  onExitCapRateChange: (value: number) => void;
}

export function StepRefinance({ data, arv, exitCapRate, projectionYears, onChange, onArvChange, onExitCapRateChange }: StepRefinanceProps) {
  const refiYearOptions = Array.from({ length: projectionYears }, (_, i) => ({
    value: String(i + 1),
    label: `Year ${i + 1}`,
  }));

  return (
    <div className="space-y-4">
      <Input
        label="ARV / Market Value ($)"
        type="number"
        fullWidth
        min={0}
        placeholder="e.g. 420,000"
        value={arv || ''}
        onChange={(e) => onArvChange(Number(e.target.value))}
        helperText="After-repair value for a rehab, or current market value for a turnkey. Used to size the refi loan and calculate equity."
      />

      <Input
        label="Exit Cap Rate (%)"
        type="number"
        fullWidth
        min={0}
        max={20}
        step={0.25}
        placeholder="e.g. 6.0"
        value={exitCapRate || ''}
        onChange={(e) => onExitCapRateChange(Number(e.target.value))}
        helperText={
          exitCapRate > 0 && arv > 0
            ? `Exit value = Year N NOI ÷ ${exitCapRate}% — overrides ARV for IRR`
            : 'Used to calculate exit property value for IRR. Leave blank to use ARV.'
        }
      />

      <div className="border-t border-slate-100 dark:border-slate-700 pt-4">
        <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
          Optionally model a future cash-out refinance to recapture equity or lower your rate.
        </p>

      <label className="flex items-center gap-3 cursor-pointer">
        <input
          type="checkbox"
          className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
          checked={data.enabled}
          onChange={(e) => onChange('enabled', e.target.checked)}
        />
        <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
          Model a cash-out refinance
        </span>
      </label>

      {data.enabled && (
        <div className="space-y-4 pt-1 pl-7">
          <Select
            label="Refinance Year"
            fullWidth
            value={String(data.refiYear)}
            onChange={(e) => onChange('refiYear', Number(e.target.value))}
            options={refiYearOptions}
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="New LTV (%)"
              type="number"
              fullWidth
              min={0}
              max={100}
              step={1}
              placeholder="e.g. 75"
              value={data.newLTV || ''}
              onChange={(e) => onChange('newLTV', Number(e.target.value))}
              helperText={arv > 0 ? `= $${Math.round(arv * (data.newLTV / 100)).toLocaleString()} loan` : undefined}
            />
            <Input
              label="New Interest Rate (%)"
              type="number"
              fullWidth
              min={0}
              max={30}
              step={0.125}
              placeholder="e.g. 6.5"
              value={data.newInterestRate || ''}
              onChange={(e) => onChange('newInterestRate', Number(e.target.value))}
            />
          </div>
          <Input
            label="New Loan Term (years)"
            type="number"
            fullWidth
            min={1}
            max={40}
            placeholder="e.g. 30"
            value={data.newLoanTermYears || ''}
            onChange={(e) => onChange('newLoanTermYears', Number(e.target.value))}
          />
        </div>
      )}
      </div>
    </div>
  );
}
