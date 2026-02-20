'use client';

import { Plus, Trash2 } from 'lucide-react';
import { formatCurrency } from '@/utils/cashOnCashCalc';
import type { CoCCostItem } from '@/types';

interface CostItemListProps {
  items: CoCCostItem[];
  placeholder: string;
  onAdd: () => void;
  onUpdate: (id: string, field: 'description' | 'amount', value: string | number) => void;
  onRemove: (id: string) => void;
}

export function CostItemList({ items, placeholder, onAdd, onUpdate, onRemove }: CostItemListProps) {
  const total = items.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="space-y-2">
          <div className="grid grid-cols-[1fr_120px_32px] gap-2 px-0.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Description</span>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Amount ($)</span>
            <span />
          </div>

          {items.map((item) => (
            <div key={item.id} className="grid grid-cols-[1fr_120px_32px] gap-2 items-center">
              <input
                type="text"
                className="input text-sm"
                placeholder={placeholder}
                value={item.description}
                onChange={(e) => onUpdate(item.id, 'description', e.target.value)}
              />
              <input
                type="number"
                className="input text-sm"
                min={0}
                placeholder="0"
                value={item.amount === 0 ? '' : item.amount}
                onChange={(e) => onUpdate(item.id, 'amount', Number(e.target.value))}
              />
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                aria-label="Remove item"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <div className="flex justify-end pt-1 border-t border-slate-100 dark:border-slate-700">
            <span className="text-sm font-semibold text-slate-900 dark:text-white">
              Total: {formatCurrency(total)}
            </span>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={onAdd}
        className="flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium transition-colors"
      >
        <Plus size={15} />
        Add item
      </button>
    </div>
  );
}
