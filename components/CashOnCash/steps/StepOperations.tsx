'use client';

import { Input } from '@/components/UI/Input';
import { formatCurrency } from '@/utils/cashOnCashCalc';
import type { CoCOperations, CoCUnitMixEntry } from '@/types';

interface StepOperationsProps {
  data: CoCOperations;
  onChange: (field: keyof CoCOperations, value: number) => void;
  unitMix: CoCUnitMixEntry[];
}

export function StepOperations({ data, onChange, unitMix }: StepOperationsProps) {
  const hasUnitMix = unitMix.length > 0;
  const unitMixRent = unitMix.reduce((sum, e) => sum + e.count * e.rentMonthly, 0);

  return (
    <div className="space-y-4">
      {hasUnitMix ? (
        <div className="rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800 p-3 text-sm text-primary-700 dark:text-primary-300">
          Gross rent is driven by your unit mix:{' '}
          <span className="font-semibold">{formatCurrency(unitMixRent)}/mo</span>. Update it on
          the Property step.
        </div>
      ) : (
        <Input
          label="Gross Rent / Month / Unit ($)"
          type="number"
          fullWidth
          min={0}
          placeholder="e.g. 2,000"
          value={data.grossRentMonthly || ''}
          onChange={(e) => onChange('grossRentMonthly', Number(e.target.value))}
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Vacancy Rate (%)"
          type="number"
          fullWidth
          min={0}
          max={100}
          step={0.5}
          placeholder="e.g. 5"
          value={data.vacancyRatePct || ''}
          onChange={(e) => onChange('vacancyRatePct', Number(e.target.value))}
        />
        <Input
          label="Operating Expenses (%)"
          type="number"
          fullWidth
          min={0}
          max={100}
          step={1}
          placeholder="e.g. 30"
          value={data.opexPct || ''}
          onChange={(e) => onChange('opexPct', Number(e.target.value))}
          helperText="% of effective gross income"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Property Mgmt (%)"
          type="number"
          fullWidth
          min={0}
          max={30}
          step={0.5}
          placeholder="e.g. 8"
          value={data.propertyMgmtPct || ''}
          onChange={(e) => onChange('propertyMgmtPct', Number(e.target.value))}
          helperText="% of effective gross income"
        />
        <Input
          label="Annual Rent Growth (%)"
          type="number"
          fullWidth
          min={-10}
          max={20}
          step={0.5}
          placeholder="e.g. 3"
          value={data.annualRentGrowthPct || ''}
          onChange={(e) => onChange('annualRentGrowthPct', Number(e.target.value))}
        />
      </div>
    </div>
  );
}
