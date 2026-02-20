'use client';

import { Input } from '@/components/UI/Input';
import { CostItemList } from '../CostItemList';
import type { CoCAcquisition, CoCCostItem } from '@/types';

type RenovationFields = Pick<
  CoCAcquisition,
  'hardCostItems' | 'softCostItems' | 'opportunityCostItems' | 'renovationMonths'
>;

interface StepRenovationProps {
  data: RenovationFields;
  onChange: (field: keyof CoCAcquisition, value: unknown) => void;
}

const newItem = (): CoCCostItem => ({
  id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  description: '',
  amount: 0,
});

type ItemField = 'hardCostItems' | 'softCostItems' | 'opportunityCostItems';

export function StepRenovation({ data, onChange }: StepRenovationProps) {
  const makeAdder = (field: ItemField) => () =>
    onChange(field, [...data[field], newItem()]);

  const makeUpdater =
    (field: ItemField) =>
    (id: string, key: 'description' | 'amount', value: string | number) =>
      onChange(
        field,
        data[field].map((item) => (item.id === id ? { ...item, [key]: value } : item))
      );

  const makeRemover = (field: ItemField) => (id: string) =>
    onChange(
      field,
      data[field].filter((item) => item.id !== id)
    );

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-500 dark:text-slate-400">
        Leave empty if purchasing a stabilized, move-in ready property.
      </p>

      <div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          Hard Costs
          <span className="ml-1.5 text-xs font-normal text-slate-400">
            (labor, materials, permits, GC fees)
          </span>
        </p>
        <CostItemList
          items={data.hardCostItems}
          placeholder="e.g. Framing, Roofing, HVAC…"
          onAdd={makeAdder('hardCostItems')}
          onUpdate={makeUpdater('hardCostItems')}
          onRemove={makeRemover('hardCostItems')}
        />
      </div>

      <div className="border-t border-slate-100 dark:border-slate-700" />

      <div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          Soft Costs
          <span className="ml-1.5 text-xs font-normal text-slate-400">
            (architect, legal, engineering, inspections)
          </span>
        </p>
        <CostItemList
          items={data.softCostItems}
          placeholder="e.g. Architect fee, Permits, Legal…"
          onAdd={makeAdder('softCostItems')}
          onUpdate={makeUpdater('softCostItems')}
          onRemove={makeRemover('softCostItems')}
        />
      </div>

      <div className="border-t border-slate-100 dark:border-slate-700" />

      <div>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
          Lost Opportunity Cost
          <span className="ml-1.5 text-xs font-normal text-slate-400">
            (costs while the property is not generating income)
          </span>
        </p>
        <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
          e.g. lost rental revenue, utilities, insurance, property taxes, HOA, loan carry
        </p>
        <CostItemList
          items={data.opportunityCostItems}
          placeholder="e.g. Lost rental revenue, Utilities…"
          onAdd={makeAdder('opportunityCostItems')}
          onUpdate={makeUpdater('opportunityCostItems')}
          onRemove={makeRemover('opportunityCostItems')}
        />
      </div>

      <div className="border-t border-slate-100 dark:border-slate-700" />

      <Input
        label="Renovation Duration (months)"
        type="number"
        fullWidth
        min={0}
        max={60}
        value={data.renovationMonths}
        onChange={(e) => onChange('renovationMonths', Number(e.target.value))}
        helperText="For reference — how long before the property stabilizes"
      />
    </div>
  );
}
