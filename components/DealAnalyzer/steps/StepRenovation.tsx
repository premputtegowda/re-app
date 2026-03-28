'use client';

import { CostItemList } from '../CostItemList';
import type { CoCAcquisition, CoCCostItem } from '@/types';

type RenovationFields = Pick<
  CoCAcquisition,
  'hardCostItems' | 'softCostItems'
>;

interface StepRenovationProps {
  data: RenovationFields;
  onChange: (field: keyof CoCAcquisition, value: unknown) => void;
  showWarnings?: boolean;
}

const newItem = (): CoCCostItem => ({
  id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  description: '',
  amount: 0,
});

export function StepRenovation({ data, onChange, showWarnings = false }: StepRenovationProps) {
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
          showWarnings={showWarnings}
          onAdd={(description) => onChange('hardCostItems', [...data.hardCostItems, { ...newItem(), description }])}
          onUpdate={(id, key, value) => onChange('hardCostItems', data.hardCostItems.map(item => item.id === id ? { ...item, [key]: value } : item))}
          onRemove={(id) => onChange('hardCostItems', data.hardCostItems.filter(item => item.id !== id))}
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
          showWarnings={showWarnings}
          onAdd={(description) => onChange('softCostItems', [...data.softCostItems, { ...newItem(), description }])}
          onUpdate={(id, key, value) => onChange('softCostItems', data.softCostItems.map(item => item.id === id ? { ...item, [key]: value } : item))}
          onRemove={(id) => onChange('softCostItems', data.softCostItems.filter(item => item.id !== id))}
        />
      </div>
    </div>
  );
}
