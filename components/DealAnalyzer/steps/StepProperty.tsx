'use client';

import { Home, Building2, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { AddressAutocomplete } from '@/components/UI/AddressAutocomplete';
import type { CoCAcquisition, CoCUnitMixEntry, RentalType } from '@/types';

const RENTAL_TYPES: { value: RentalType; label: string; sub: string }[] = [
  { value: 'LTR', label: 'LTR', sub: 'Long-term' },
  { value: 'MTR', label: 'MTR', sub: 'Mid-term' },
  { value: 'STR', label: 'STR', sub: 'Short-term' },
];

const newUnitEntry = (): CoCUnitMixEntry => ({
  id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  beds: 1,
  baths: 1,
  count: 1,
  inPlaceRent: 0,
  preStabRent: 0,
  rentMonthly: 0,
  rentalType: 'LTR',
});

interface StepPropertyProps {
  data: Pick<CoCAcquisition, 'propertyAddress' | 'propertyType' | 'units' | 'sfrBeds' | 'sfrBaths' | 'sfrInPlaceRent' | 'sfrPreStabRent' | 'sfrTargetRent' | 'sfrRentalType' | 'unitMix' | 'purchasePrice'>;
  onChange: (field: keyof CoCAcquisition, value: unknown) => void;
  showWarnings?: boolean;
}

function RentalTypePicker({ value, onChange }: { value: RentalType; onChange: (v: RentalType) => void }) {
  return (
    <div className="inline-flex h-7 rounded border border-slate-200 dark:border-slate-700 overflow-hidden self-end mb-[3px]">
      {RENTAL_TYPES.map((t) => {
        const active = value === t.value;
        return (
          <button
            key={t.value}
            type="button"
            onClick={() => onChange(t.value)}
            className={`px-2.5 text-[11px] font-medium transition-colors border-l first:border-l-0 border-slate-200 dark:border-slate-700 ${
              active
                ? 'bg-primary-600 text-white'
                : 'bg-white dark:bg-slate-800 text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-slate-700'
            }`}
            title={t.sub}
          >
            {t.label}
          </button>
        );
      })}
    </div>
  );
}

export function StepProperty({ data, onChange, showWarnings = false }: StepPropertyProps) {
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
      data.unitMix.map((e) => {
        if (e.id !== id) return e;
        const updated = { ...e, [field]: value };
        // When count is reduced, clamp dependent fields so they don't exceed available units
        if (field === 'count') {
          if ((updated.unitsToRenovate ?? 0) > value) updated.unitsToRenovate = value;
          const remainingForLeaseUp = value - (updated.unitsToRenovate ?? 0);
          if ((updated.leaseUpUnits ?? 0) > remainingForLeaseUp) updated.leaseUpUnits = Math.max(0, remainingForLeaseUp);
        }
        return updated;
      })
    );

  const updateUnitRentalType = (id: string, value: RentalType) =>
    onChange(
      'unitMix',
      data.unitMix.map((e) => (e.id === id ? { ...e, rentalType: value } : e))
    );

  const removeUnitEntry = (id: string) =>
    onChange('unitMix', data.unitMix.filter((e) => e.id !== id));

  return (
    <div className="space-y-5">
      {/* Address */}
      <AddressAutocomplete
        value={data.propertyAddress}
        onChange={(val) => onChange('propertyAddress', val)}
      />

      {/* Purchase Price */}
      <div>
        <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
          Purchase Price ($)
          {showWarnings && !(data.purchasePrice > 0) && (
            <AlertTriangle size={12} className="text-amber-500 shrink-0" />
          )}
        </label>
        <input
          type="number"
          className={`input text-sm ${showWarnings && !(data.purchasePrice > 0) ? 'border-amber-300 focus:ring-amber-400' : ''}`}
          min={0}
          placeholder="e.g. 350,000"
          value={data.purchasePrice || ''}
          onChange={(e) => onChange('purchasePrice', Number(e.target.value))}
        />
      </div>

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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                Bedrooms
                {showWarnings && !data.sfrBeds && (
                  <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                )}
              </label>
              <input
                type="number"
                className={`input text-sm ${showWarnings && !data.sfrBeds ? 'border-amber-300 focus:ring-amber-400' : ''}`}
                min={0}
                max={20}
                placeholder="e.g. 3"
                value={data.sfrBeds || ''}
                onChange={(e) => onChange('sfrBeds', Number(e.target.value))}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1 flex items-center gap-1">
                Bathrooms
                {showWarnings && !data.sfrBaths && (
                  <AlertTriangle size={12} className="text-amber-500 shrink-0" />
                )}
              </label>
              <input
                type="number"
                className={`input text-sm ${showWarnings && !data.sfrBaths ? 'border-amber-300 focus:ring-amber-400' : ''}`}
                min={0}
                max={20}
                step={0.5}
                placeholder="e.g. 2"
                value={data.sfrBaths || ''}
                onChange={(e) => onChange('sfrBaths', Number(e.target.value))}
              />
            </div>
          </div>
          <div className="mt-3">
            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1.5">Rental Strategy</p>
            <RentalTypePicker
              value={data.sfrRentalType ?? 'LTR'}
              onChange={(v) => onChange('sfrRentalType', v)}
            />
          </div>
        </div>
      )}

      {/* MFR — unit mix */}
      {data.propertyType === 'mfr' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 flex items-center gap-1">
              Unit Mix
              {showWarnings && data.unitMix.length === 0 && (
                <AlertTriangle size={12} className="text-amber-500 shrink-0" />
              )}
            </p>
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
                  className="rounded-lg border border-slate-100 dark:border-slate-700 p-3"
                >
                  {/* Beds / Baths / Count / Rental Strategy / Delete — all inline */}
                  <div className="grid grid-cols-[1fr_1fr_1fr_auto_32px] gap-2 items-end">
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
                    <div>
                      <span className="text-xs font-medium text-slate-500 dark:text-slate-400 block mb-1 text-center">Rental Strategy</span>
                      <RentalTypePicker
                        value={entry.rentalType ?? 'LTR'}
                        onChange={(v) => updateUnitRentalType(entry.id, v)}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => removeUnitEntry(entry.id)}
                      className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
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
