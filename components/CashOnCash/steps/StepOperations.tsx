'use client';

import { Input } from '@/components/UI/Input';
import type { CoCOperations } from '@/types';

interface StepOperationsProps {
  data: CoCOperations;
  onChange: (field: keyof CoCOperations, value: number) => void;
}

export function StepOperations({ data, onChange }: StepOperationsProps) {
  return (
    <div className="space-y-4">
      <Input
        label="Gross Rent / Month / Unit ($)"
        type="number"
        fullWidth
        min={0}
        value={data.grossRentMonthly}
        onChange={(e) => onChange('grossRentMonthly', Number(e.target.value))}
      />
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Vacancy Rate (%)"
          type="number"
          fullWidth
          min={0}
          max={100}
          step={0.5}
          value={data.vacancyRatePct}
          onChange={(e) => onChange('vacancyRatePct', Number(e.target.value))}
        />
        <Input
          label="Operating Expenses (%)"
          type="number"
          fullWidth
          min={0}
          max={100}
          step={1}
          value={data.opexPct}
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
          value={data.propertyMgmtPct}
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
          value={data.annualRentGrowthPct}
          onChange={(e) => onChange('annualRentGrowthPct', Number(e.target.value))}
        />
      </div>
    </div>
  );
}
