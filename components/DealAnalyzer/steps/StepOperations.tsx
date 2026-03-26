'use client';

import { Input } from '@/components/UI/Input';
import { formatCurrency } from '@/utils/dealAnalyzerCalc';
import type { CoCOperations, CoCPropertyType, CoCUnitMixEntry } from '@/types';

interface StepOperationsProps {
  data: CoCOperations;
  onChange: (field: keyof CoCOperations, value: number) => void;
  propertyType: CoCPropertyType;
  unitMix: CoCUnitMixEntry[];
  onUnitMixChange: (unitMix: CoCUnitMixEntry[]) => void;
}

export function StepOperations({ data, onChange, propertyType, unitMix, onUnitMixChange }: StepOperationsProps) {
  const isMfr = propertyType === 'mfr';
  const hasUnitMix = unitMix.length > 0;
  const totalUnits = unitMix.reduce((sum, e) => sum + e.count, 0);
  const totalRent = unitMix.reduce((sum, e) => sum + e.count * e.rentMonthly, 0);

  const updateUnitRent = (id: string, rentMonthly: number) =>
    onUnitMixChange(unitMix.map((e) => (e.id === id ? { ...e, rentMonthly } : e)));

  const unitLabel = (e: CoCUnitMixEntry) => {
    const beds = e.beds === 0 ? 'Studio' : `${e.beds}BR`;
    const baths = `${e.baths}BA`;
    return `${beds} / ${baths}`;
  };

  return (
    <div className="space-y-4">
      {isMfr && hasUnitMix ? (
        <div className="space-y-2">
          <p className="label">Rent by Unit Type</p>

          {/* Column headers */}
          <div className="grid grid-cols-[1fr_48px_1fr] gap-2 px-0.5">
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Unit Type</span>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400 text-center">Count</span>
            <span className="text-xs font-medium text-slate-500 dark:text-slate-400">Rent / mo ($)</span>
          </div>

          {unitMix.map((entry) => (
            <div key={entry.id} className="grid grid-cols-[1fr_48px_1fr] gap-2 items-center">
              <span className="text-sm text-slate-700 dark:text-slate-300 font-medium">
                {unitLabel(entry)}
              </span>
              <span className="text-sm text-slate-500 dark:text-slate-400 text-center">
                ×{entry.count}
              </span>
              <input
                type="number"
                className="input text-sm"
                min={0}
                placeholder="0"
                value={entry.rentMonthly === 0 ? '' : entry.rentMonthly}
                onChange={(e) => updateUnitRent(entry.id, Number(e.target.value))}
              />
            </div>
          ))}

          {/* Totals row */}
          <div className="flex justify-between pt-1.5 border-t border-slate-100 dark:border-slate-700 text-sm font-semibold text-slate-900 dark:text-white">
            <span>{totalUnits} units total</span>
            <span>{formatCurrency(totalRent)} / mo</span>
          </div>
        </div>
      ) : (
        <Input
          label="Gross Rent / Month / Unit ($)"
          type="number"
          fullWidth
          min={0}
          placeholder="e.g. 2,000"
          value={data.grossRentMonthly || ''}
          onChange={(e) => onChange('grossRentMonthly', Number(e.target.value))}
        />
      )}

      <div className="grid grid-cols-2 gap-4">
        <Input
          label="Vacancy Rate (%)"
          type="number"
          fullWidth
          min={0}
          max={100}
          step={0.5}
          placeholder="e.g. 5"
          value={data.vacancyRatePct || ''}
          onChange={(e) => onChange('vacancyRatePct', Number(e.target.value))}
        />
        <Input
          label="Operating Expenses (%)"
          type="number"
          fullWidth
          min={0}
          max={100}
          step={1}
          placeholder="e.g. 30"
          value={data.opexPct || ''}
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
          placeholder="e.g. 8"
          value={data.propertyMgmtPct || ''}
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
          placeholder="e.g. 3"
          value={data.annualRentGrowthPct || ''}
          onChange={(e) => onChange('annualRentGrowthPct', Number(e.target.value))}
        />
      </div>
    </div>
  );
}
