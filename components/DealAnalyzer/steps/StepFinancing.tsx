'use client';

import { Input } from '@/components/UI/Input';
import { CostItemList } from '../CostItemList';
import type { CoCAcquisition, CoCCostItem } from '@/types';

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
>;

const newItem = (): CoCCostItem => ({
  id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  description: '',
  amount: 0,
});

interface StepFinancingProps {
  data: FinancingFields;
  onChange: (field: keyof CoCAcquisition, value: unknown) => void;
  missingFields?: Set<string>;
}

export function StepFinancing({ data, onChange, missingFields }: StepFinancingProps) {
  const isCash = data.downPaymentPct >= 100;
  const warn = (field: string) => missingFields?.has(field) ?? false;

  return (
    <div className="space-y-4">
      <Input
        label="Purchase Price ($)"
        type="number"
        fullWidth
        min={0}
        placeholder="e.g. 350,000"
        value={data.purchasePrice || ''}
        onChange={(e) => onChange('purchasePrice', Number(e.target.value))}
        warning={warn('purchasePrice')}
      />

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
        helperText={data.purchasePrice > 0 && data.downPaymentPct > 0
          ? `= $${Math.round(data.purchasePrice * data.downPaymentPct / 100).toLocaleString()}${isCash ? ' — Cash purchase' : ''}`
          : '% of purchase price (enter 100 for all-cash)'}
        warning={warn('downPaymentPct')}
      />

      {!isCash && (
        <>
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
              helperText={data.purchasePrice > 0 && data.closingCostsPct > 0
                ? `= $${Math.round(data.purchasePrice * data.closingCostsPct / 100).toLocaleString()}`
                : '% of purchase price'}
              warning={warn('closingCostsPct')}
            />
            <Input
              label="Loan Points"
              type="number"
              fullWidth
              min={0}
              max={10}
              step={0.25}
              placeholder="e.g. 1"
              value={data.points || ''}
              onChange={(e) => onChange('points', Number(e.target.value))}
              helperText={data.purchasePrice > 0 && data.downPaymentPct > 0 && data.points > 0
                ? `= $${Math.round(data.purchasePrice * (1 - data.downPaymentPct / 100) * data.points / 100).toLocaleString()}`
                : '1 point = 1% of loan'}
              warning={warn('points')}
            />
          </div>

          <div>
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
                onChange('additionalFeeItems', (data.additionalFeeItems ?? []).map(item =>
                  item.id === id ? { ...item, [field]: value } : item
                ))
              }
              onRemove={(id) =>
                onChange('additionalFeeItems', (data.additionalFeeItems ?? []).filter(item => item.id !== id))
              }
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
              warning={warn('interestRate')}
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
              warning={warn('loanTermYears')}
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
        </>
      )}

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
