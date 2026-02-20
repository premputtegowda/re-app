'use client';

import { Input } from '@/components/UI/Input';
import { Select } from '@/components/UI/Select';
import type { CoCAcquisition } from '@/types';

type FinancingFields = Pick<
  CoCAcquisition,
  | 'purchasePrice'
  | 'arv'
  | 'downPaymentPct'
  | 'closingCostsPct'
  | 'points'
  | 'interestRate'
  | 'loanTermYears'
  | 'ioPeriodMonths'
  | 'projectionYears'
>;

interface StepFinancingProps {
  data: FinancingFields;
  onChange: (field: keyof CoCAcquisition, value: number) => void;
}

export function StepFinancing({ data, onChange }: StepFinancingProps) {
  const projectionOptions = Array.from({ length: 10 }, (_, i) => ({
    value: String(i + 1),
    label: `${i + 1} ${i + 1 === 1 ? 'year' : 'years'}`,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Purchase Price ($)"
          type="number"
          fullWidth
          min={0}
          value={data.purchasePrice}
          onChange={(e) => onChange('purchasePrice', Number(e.target.value))}
        />
        <Input
          label="After Repair Value ($)"
          type="number"
          fullWidth
          min={0}
          value={data.arv}
          onChange={(e) => onChange('arv', Number(e.target.value))}
          helperText="ARV after renovation"
        />
      </div>

      <Input
        label="Down Payment (%)"
        type="number"
        fullWidth
        min={0}
        max={100}
        step={0.5}
        value={data.downPaymentPct}
        onChange={(e) => onChange('downPaymentPct', Number(e.target.value))}
      />

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Closing Costs (%)"
          type="number"
          fullWidth
          min={0}
          max={10}
          step={0.1}
          value={data.closingCostsPct}
          onChange={(e) => onChange('closingCostsPct', Number(e.target.value))}
          helperText="% of purchase price"
        />
        <Input
          label="Loan Points"
          type="number"
          fullWidth
          min={0}
          max={10}
          step={0.25}
          value={data.points}
          onChange={(e) => onChange('points', Number(e.target.value))}
          helperText="1 point = 1% of loan"
        />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Interest Rate (%)"
          type="number"
          fullWidth
          min={0}
          max={30}
          step={0.125}
          value={data.interestRate}
          onChange={(e) => onChange('interestRate', Number(e.target.value))}
        />
        <Input
          label="Loan Term (years)"
          type="number"
          fullWidth
          min={1}
          max={40}
          value={data.loanTermYears}
          onChange={(e) => onChange('loanTermYears', Number(e.target.value))}
        />
      </div>

      <Input
        label="Interest-Only Period (months)"
        type="number"
        fullWidth
        min={0}
        value={data.ioPeriodMonths}
        onChange={(e) => onChange('ioPeriodMonths', Number(e.target.value))}
        helperText="Enter 0 for a fully amortizing loan"
      />

      <Select
        label="Projection Horizon"
        fullWidth
        value={String(data.projectionYears)}
        onChange={(e) => onChange('projectionYears', Number(e.target.value))}
        options={projectionOptions}
      />
    </div>
  );
}
