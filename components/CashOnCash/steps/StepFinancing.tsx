'use client';

import { Input } from '@/components/UI/Input';
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
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Purchase Price ($)"
          type="number"
          fullWidth
          min={0}
          placeholder="e.g. 350,000"
          value={data.purchasePrice || ''}
          onChange={(e) => onChange('purchasePrice', Number(e.target.value))}
        />
        <Input
          label="After Repair Value ($)"
          type="number"
          fullWidth
          min={0}
          placeholder="e.g. 420,000"
          value={data.arv || ''}
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
        placeholder="e.g. 20"
        value={data.downPaymentPct || ''}
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
          placeholder="e.g. 2"
          value={data.closingCostsPct || ''}
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
          placeholder="0"
          value={data.points || ''}
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
          placeholder="e.g. 7.0"
          value={data.interestRate || ''}
          onChange={(e) => onChange('interestRate', Number(e.target.value))}
        />
        <Input
          label="Loan Term (years)"
          type="number"
          fullWidth
          min={1}
          max={40}
          placeholder="e.g. 30"
          value={data.loanTermYears || ''}
          onChange={(e) => onChange('loanTermYears', Number(e.target.value))}
        />
      </div>

      <Input
        label="Interest-Only Period (months)"
        type="number"
        fullWidth
        min={0}
        placeholder="0"
        value={data.ioPeriodMonths || ''}
        onChange={(e) => onChange('ioPeriodMonths', Number(e.target.value))}
        helperText="Leave blank for a fully amortizing loan"
      />

      <Input
        label="Projection Horizon (years)"
        type="number"
        fullWidth
        min={1}
        max={30}
        placeholder="5"
        value={data.projectionYears || ''}
        onChange={(e) => onChange('projectionYears', Number(e.target.value))}
        helperText="How many years to model (1–30)"
      />
    </div>
  );
}
