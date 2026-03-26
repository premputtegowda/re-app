'use client';

import { useState } from 'react';
import { Card } from '@/components/UI/Card';
import { Input } from '@/components/UI/Input';
import type { CoCAcquisition, CoCRefinance } from '@/types';

interface ExitAndRefiPanelProps {
  acquisition: CoCAcquisition;
  refinance: CoCRefinance;
  onAcquisitionChange: (field: keyof CoCAcquisition, value: unknown) => void;
  onRefinanceChange: (field: keyof CoCRefinance, value: number | boolean) => void;
}

export function ExitAndRefiPanel({ acquisition, refinance, onAcquisitionChange, onRefinanceChange }: ExitAndRefiPanelProps) {
  const [refiOpen, setRefiOpen] = useState(false);
  const projectionYears = acquisition.projectionYears || 5;

  return (
    <div className="space-y-3">
      {/* Exit Assumptions — always visible */}
      <Card>
        <p className="text-xs font-bold uppercase tracking-widest text-slate-400 dark:text-slate-500 mb-3">Exit Assumptions</p>
        <div className="grid grid-cols-3 gap-4">
          <Input
            label="Exit Value / ARV ($)"
            type="number"
            fullWidth
            min={0}
            placeholder="e.g. 420,000"
            value={acquisition.arv || ''}
            onChange={(e) => onAcquisitionChange('arv', Number(e.target.value))}
            helperText="Used as terminal value for IRR"
          />
          <Input
            label="Exit Cap Rate (%)"
            type="number"
            fullWidth
            min={0}
            max={20}
            step={0.25}
            placeholder="e.g. 6.0"
            value={acquisition.exitCapRate || ''}
            onChange={(e) => onAcquisitionChange('exitCapRate', Number(e.target.value))}
            helperText={acquisition.exitCapRate > 0 ? `Overrides ARV for exit value` : 'Overrides ARV if set'}
          />
          <Input
            label="Selling Costs (%)"
            type="number"
            fullWidth
            min={0}
            max={20}
            step={0.25}
            placeholder="e.g. 3"
            value={acquisition.exitClosingCostPct ?? 3}
            onChange={(e) => onAcquisitionChange('exitClosingCostPct', Number(e.target.value))}
            helperText={acquisition.arv > 0 && (acquisition.exitClosingCostPct ?? 3) > 0
              ? `= $${Math.round(acquisition.arv * (acquisition.exitClosingCostPct ?? 3) / 100).toLocaleString()}`
              : 'Agent fees, transfer tax, etc.'}
          />
        </div>
      </Card>

      {/* Cash-Out Refinance — collapsible */}
      <Card padding="none">
        <button
          type="button"
          onClick={() => setRefiOpen(v => !v)}
          className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors rounded-xl"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">Cash-Out Refinance</span>
            {refinance.enabled && (
              <span className="text-[10px] font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-1.5 py-0.5 rounded-full">active</span>
            )}
          </div>
          <span className="text-xs text-slate-400">{refiOpen ? '▲ collapse' : '▼ expand'}</span>
        </button>

        {refiOpen && (
          <div className="px-5 pb-5 space-y-4 border-t border-slate-100 dark:border-slate-700 pt-4">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                checked={refinance.enabled}
                onChange={(e) => onRefinanceChange('enabled', e.target.checked)}
              />
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Model a cash-out refinance</span>
            </label>

            {refinance.enabled && (
              <div className="space-y-4 pl-7">
                <Input
                  label="Market Value at Refi ($)"
                  type="number"
                  fullWidth
                  min={0}
                  placeholder="e.g. 400,000"
                  value={refinance.refiMarketValue || ''}
                  onChange={(e) => onRefinanceChange('refiMarketValue', Number(e.target.value))}
                  helperText="Property value at the time of refinancing"
                />

                {/* Refi Year chips */}
                <div>
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2">Refinance Year</p>
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: projectionYears }, (_, i) => i + 1).map(yr => (
                      <button
                        key={yr}
                        type="button"
                        onClick={() => onRefinanceChange('refiYear', yr)}
                        className={`px-3 py-1 rounded-full text-sm font-medium border transition-all ${
                          refinance.refiYear === yr
                            ? 'bg-primary-600 border-primary-600 text-white'
                            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-primary-400 hover:text-primary-600'
                        }`}
                      >
                        Yr {yr}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <Input
                    label="New LTV (%)"
                    type="number"
                    fullWidth
                    min={0}
                    max={100}
                    step={1}
                    placeholder="e.g. 75"
                    value={refinance.newLTV || ''}
                    onChange={(e) => onRefinanceChange('newLTV', Number(e.target.value))}
                    helperText={refinance.refiMarketValue > 0 ? `= $${Math.round(refinance.refiMarketValue * (refinance.newLTV / 100)).toLocaleString()} loan` : undefined}
                  />
                  <Input
                    label="New Interest Rate (%)"
                    type="number"
                    fullWidth
                    min={0}
                    max={30}
                    step={0.125}
                    placeholder="e.g. 6.5"
                    value={refinance.newInterestRate || ''}
                    onChange={(e) => onRefinanceChange('newInterestRate', Number(e.target.value))}
                  />
                </div>

                <Input
                  label="New Loan Term (years)"
                  type="number"
                  fullWidth
                  min={1}
                  max={40}
                  placeholder="e.g. 30"
                  value={refinance.newLoanTermYears || ''}
                  onChange={(e) => onRefinanceChange('newLoanTermYears', Number(e.target.value))}
                />
              </div>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
