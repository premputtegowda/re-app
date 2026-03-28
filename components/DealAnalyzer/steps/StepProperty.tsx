'use client';

import { Home, Building2, Plus, Trash2 } from 'lucide-react';
import { Input } from '@/components/UI/Input';
import type { CoCAcquisition, CoCUnitMixEntry } from '@/types';

const newUnitEntry = (): CoCUnitMixEntry => ({
  id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  beds: 1,
  baths: 1,
  count: 1,
  inPlaceRent: 0,
  preStabRent: 0,
  rentMonthly: 0,
});

interface StepPropertyProps {
  data: Pick<CoCAcquisition, 'propertyAddress' | 'propertyType' | 'units' | 'sfrBeds' | 'sfrBaths' | 'sfrInPlaceRent' | 'sfrPreStabRent' | 'sfrTargetRent' | 'unitMix'>;
  onChange: (field: keyof CoCAcquisition, value: unknown) => void;
}

export function StepProperty({ data, onChange }: StepPropertyProps) {
  const totalUnits = data.unitMix.reduce((sum, e) => sum + e.count, 0);

  const addUnitEntry = () =>
    onChange('unitMix', [...data.unitMix, newUnitEntry()]);

  const updateUnitEntry = (
    id: string,
    field: keyof Omit<CoCUnitMixEntry, 'id'>,
    value: number
  ) =>
    onChange(
      'unitMix',
      data.unitMix.map((e) => (e.id === id ? { ...e, [field]: value } : e))
    );

  const removeUnitEntry = (id: string) =>
    onChange('unitMix', data.unitMix.filter((e) => e.id !== id));

  return (
    <div className="space-y-5">
      {/* Address */}
      <Input
        label="Property Address"
        type="text"
        fullWidth
        placeholder="e.g. 123 Main St, Austin TX 78701"
        value={data.propertyAddress}
        onChange={(e) => onChange('propertyAddress', e.target.value)}
      />

      {/* Property type — icon buttons */}
      <div>
        <p className="label">Property Type</p>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              { type: 'sfr', Icon: Home, title: 'Single Family', sub: 'SFR' },
              { type: 'mfr', Icon: Building2, title: 'Multi-Family', sub: 'MFR' },
            ] as const
          ).map(({ type, Icon, title, sub }) => {
            const isActive = data.propertyType === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  onChange('propertyType', type);
                  if (type === 'sfr') onChange('unitMix', []);
                }}
                className={`flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all ${
                  isActive
                    ? 'border-primary-500 bg-primary-50 dark:bg-primary-900/20 text-primary-700 dark:text-primary-300'
                    : 'border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 hover:border-primary-300 dark:hover:border-primary-700 hover:bg-slate-50 dark:hover:bg-slate-800'
                }`}
              >
                <Icon size={28} strokeWidth={isActive ? 2 : 1.5} />
                <div className="text-center">
                  <p className="text-sm font-semibold leading-tight">{title}</p>
                  <p className="text-xs opacity-70">{sub}</p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* SFR — beds & baths */}
      {data.propertyType === 'sfr' && (
        <div>
          <p className="label mb-2">Unit Details</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 block">
                Bedrooms
              </label>
              <input
                type="number"
                className="input text-sm"
                min={0}
                max={20}
                placeholder="e.g. 3"
                value={data.sfrBeds || ''}
                onChange={(e) => onChange('sfrBeds', Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 block">
                Bathrooms
              </label>
              <input
                type="number"
                className="input text-sm"
                min={0}
                max={20}
                step={0.5}
                placeholder="e.g. 2"
                value={data.sfrBaths || ''}
                onChange={(e) => onChange('sfrBaths', Number(e.target.value))}
              />
            </div>
          </div>
        </div>
      )}

      {/* MFR — unit mix */}
      {data.propertyType === 'mfr' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">Unit Mix</p>
            {totalUnits > 0 && (
              <span className="text-xs text-slate-500 dark:text-slate-400">
                {totalUnits} units
              </span>
            )}
          </div>

          {data.unitMix.length > 0 && (
            <div className="space-y-2">
              {data.unitMix.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-lg border border-slate-100 dark:border-slate-700 p-3 space-y-2"
                >
                  {/* Row 1: unit definition */}
                  <div className="grid grid-cols-[1fr_1fr_1fr_32px] gap-2 items-center">
                    <div>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block mb-1 text-center">Beds</span>
                      <input
                        type="number"
                        className="input text-sm text-center"
                        min={0}
                        max={20}
                        placeholder="0"
                        value={entry.beds === 0 ? '' : entry.beds}
                        onChange={(e) => updateUnitEntry(entry.id, 'beds', Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block mb-1 text-center">Baths</span>
                      <input
                        type="number"
                        className="input text-sm text-center"
                        min={0}
                        max={20}
                        step={0.5}
                        placeholder="0"
                        value={entry.baths === 0 ? '' : entry.baths}
                        onChange={(e) => updateUnitEntry(entry.id, 'baths', Number(e.target.value))}
                      />
                    </div>
                    <div>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block mb-1 text-center">Count</span>
                      <input
                        type="number"
                        className="input text-sm text-center"
                        min={1}
                        placeholder="1"
                        value={entry.count === 0 ? '' : entry.count}
                        onChange={(e) => updateUnitEntry(entry.id, 'count', Number(e.target.value))}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeUnitEntry(entry.id)}
                      className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors mt-5"
                      aria-label="Remove unit type"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                </div>
              ))}

              {/* Totals row */}
              <div className="pt-1.5 border-t border-slate-100 dark:border-slate-700 text-xs">
                <span className="font-semibold text-slate-700 dark:text-slate-300">{totalUnits} units total</span>
              </div>
            </div>
          )}

          <button
            type="button"
            onClick={addUnitEntry}
            className="flex items-center gap-1.5 text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 font-medium transition-colors"
          >
            <Plus size={15} />
            Add unit type
          </button>
        </div>
      )}
    </div>
  );
}
