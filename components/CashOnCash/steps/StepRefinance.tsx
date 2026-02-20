'use client';

import { Input } from '@/components/UI/Input';
import { Select } from '@/components/UI/Select';
import type { CoCRefinance } from '@/types';

interface StepRefinanceProps {
  data: CoCRefinance;
  projectionYears: number;
  onChange: (field: keyof CoCRefinance, value: number | boolean) => void;
}

export function StepRefinance({ data, projectionYears, onChange }: StepRefinanceProps) {
  const refiYearOptions = Array.from({ length: projectionYears }, (_, i) => ({
    value: String(i + 1),
    label: `Year ${i + 1}`,
  }));

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Model a future cash-out refinance to recapture equity or lower your rate.
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
          <div className="grid grid-cols-2 gap-4">
            <Input
              label="New LTV (%)"
              type="number"
              fullWidth
              min={0}
              max={100}
              step={1}
              value={data.newLTV}
              onChange={(e) => onChange('newLTV', Number(e.target.value))}
            />
            <Input
              label="New Interest Rate (%)"
              type="number"
              fullWidth
              min={0}
              max={30}
              step={0.125}
              value={data.newInterestRate}
              onChange={(e) => onChange('newInterestRate', Number(e.target.value))}
            />
          </div>
          <Input
            label="New Loan Term (years)"
            type="number"
            fullWidth
            min={1}
            max={40}
            value={data.newLoanTermYears}
            onChange={(e) => onChange('newLoanTermYears', Number(e.target.value))}
          />
        </div>
      )}
    </div>
  );
}
