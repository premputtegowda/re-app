'use client';

import { useState } from 'react';
import { Plus, Trash2, AlertTriangle } from 'lucide-react';
import { formatCurrency } from '@/utils/dealAnalyzerCalc';
import type { CoCCostItem } from '@/types';

// ── Click-to-edit cells ────────────────────────────────────────────────────────

function EditableText({ value, placeholder, onChange }: {
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const commit = () => { onChange(draft.trim() || value); setEditing(false); };
  if (editing) {
    return (
      <input
        autoFocus
        type="text"
        className="text-sm text-slate-800 dark:text-slate-200 bg-transparent border-none outline-none ring-0 p-0 w-full"
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setDraft(value); setEditing(false); }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => { setDraft(value); setEditing(true); }}
      className="text-sm text-slate-700 dark:text-slate-300 text-left w-full hover:text-primary-600 dark:hover:text-primary-400 cursor-text truncate"
    >
      {value || <span className="text-slate-400">{placeholder}</span>}
    </button>
  );
}

function EditableAmount({ value, onChange, showWarning = false }: {
  value: number;
  onChange: (v: number) => void;
  showWarning?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value === 0 ? '' : String(value));
  const commit = () => { onChange(Number(draft) || 0); setEditing(false); };
  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        className="text-sm text-slate-800 dark:text-slate-200 bg-transparent border-none outline-none ring-0 p-0 w-full text-right"
        min={0}
        value={draft}
        placeholder="0"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { setDraft(value === 0 ? '' : String(value)); setEditing(false); }
        }}
      />
    );
  }
  return (
    <button
      type="button"
      onClick={() => { setDraft(value === 0 ? '' : String(value)); setEditing(true); }}
      className="text-sm text-slate-700 dark:text-slate-300 text-right w-full hover:text-primary-600 dark:hover:text-primary-400 cursor-text flex items-center justify-end gap-1"
    >
      {showWarning && <AlertTriangle size={12} className="text-amber-500 shrink-0" />}
      {value > 0 ? formatCurrency(value) : <span className={showWarning ? 'text-amber-500' : 'text-slate-400'}>$0</span>}
    </button>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

interface CostItemListProps {
  items: CoCCostItem[];
  placeholder: string;
  addLabel?: string;
  showWarnings?: boolean;
  onAdd: (description: string) => void;
  onUpdate: (id: string, field: 'description' | 'amount', value: string | number) => void;
  onRemove: (id: string) => void;
}

export function CostItemList({ items, placeholder, addLabel = 'Add item', showWarnings = false, onAdd, onUpdate, onRemove }: CostItemListProps) {
  const [addingRow, setAddingRow] = useState(false);
  const [newName, setNewName] = useState('');

  const total = items.reduce((sum, item) => sum + item.amount, 0);

  const commitAdd = () => {
    if (newName.trim()) onAdd(newName.trim());
    setAddingRow(false);
    setNewName('');
  };

  const cancelAdd = () => {
    setAddingRow(false);
    setNewName('');
  };

  return (
    <div className="space-y-1">
      {items.length > 0 && (
        <>
          <div className="grid grid-cols-[1fr_110px_32px] gap-2 px-1 pb-1">
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500">Description</span>
            <span className="text-xs font-medium text-slate-400 dark:text-slate-500 text-right">Amount</span>
            <span />
          </div>

          {items.map((item) => (
            <div
              key={item.id}
              className="grid grid-cols-[1fr_110px_32px] gap-2 items-center px-1 py-1.5 rounded-lg hover:bg-slate-50 dark:hover:bg-slate-700/40 group transition-colors"
            >
              <EditableText
                value={item.description}
                placeholder={placeholder}
                onChange={(v) => onUpdate(item.id, 'description', v)}
              />
              <EditableAmount
                value={item.amount}
                onChange={(v) => onUpdate(item.id, 'amount', v)}
                showWarning={showWarnings && item.description.trim() !== '' && item.amount === 0}
              />
              <button
                type="button"
                onClick={() => onRemove(item.id)}
                className="flex items-center justify-center w-8 h-8 rounded-lg text-transparent group-hover:text-slate-400 hover:!text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                aria-label="Remove item"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}

          <div className="flex justify-end pt-1.5 border-t border-slate-100 dark:border-slate-700">
            <span className="text-sm font-semibold text-slate-900 dark:text-white">
              Total: {formatCurrency(total)}
            </span>
          </div>
        </>
      )}

      {addingRow ? (
        <div className="flex items-center gap-2 rounded-lg bg-primary-50/40 dark:bg-primary-900/10 border border-dashed border-primary-200 dark:border-primary-800/40 px-3 py-2.5">
          <input
            autoFocus
            type="text"
            className="flex-1 text-sm font-medium text-slate-800 dark:text-slate-200 bg-transparent border-none outline-none ring-0 p-0 placeholder:text-slate-400"
            placeholder="Description…"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitAdd(); }
              if (e.key === 'Escape') cancelAdd();
            }}
            onBlur={() => { if (newName.trim()) commitAdd(); else cancelAdd(); }}
          />
          <span className="text-xs text-slate-400 shrink-0">Enter to add · Esc to cancel</span>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAddingRow(true)}
          className="flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium transition-colors px-1 py-1"
        >
          <Plus size={15} />
          {addLabel}
        </button>
      )}
    </div>
  );
}
