'use client';

import { useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Input } from '@/components/UI/Input';
import type { CoCAcquisition, CoCRefinance } from '@/types';

interface StepExitProps {
  acquisition: CoCAcquisition;
  refinance: CoCRefinance;
  onAcquisitionChange: (field: keyof CoCAcquisition, value: unknown) => void;
  onRefinanceChange: (field: keyof CoCRefinance, value: number | boolean) => void;
  showWarnings?: boolean;
}

export function StepExit({ acquisition, refinance, onAcquisitionChange, onRefinanceChange, showWarnings = false }: StepExitProps) {
  const [refiOpen, setRefiOpen] = useState(refinance.enabled);
  const projectionYears = acquisition.projectionYears || 5;
  const method = acquisition.exitMethod ?? 'value';

  const refiEnabled = refinance.enabled;
  const warn = showWarnings && refiEnabled;
  const missingMarketValue  = warn && !refinance.refiMarketValue;
  const missingYear         = warn && !refinance.refiYear;
  const missingLTV          = warn && !refinance.newLTV;
  const missingInterestRate = warn && !refinance.newInterestRate;
  const missingLoanTerm     = warn && !refinance.newLoanTermYears;
  const hasRefiWarning = missingMarketValue || missingYear || missingLTV || missingInterestRate || missingLoanTerm;

  return (
    <div className="space-y-5">
      {/* Exit fields */}
      <div>
        <p className="label mb-3">Exit Assumptions</p>

        {/* Method toggle */}
        <div className="flex gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-700/50 mb-4 w-fit">
          {([
            { value: 'value',   label: 'ARV / Market Value' },
            { value: 'capRate', label: 'Cap Rate'            },
          ] as const).map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => onAcquisitionChange('exitMethod', value)}
              className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${
                method === value
                  ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {/* ARV / Market Value — direct dollar entry */}
          {method === 'value' && (
            <Input
              label="Exit Value / ARV ($)"
              type="number"
              fullWidth
              min={0}
              placeholder="e.g. 650,000"
              value={acquisition.arv || ''}
              onChange={(e) => onAcquisitionChange('arv', Number(e.target.value))}
              helperText="ARV or projected market value at exit"
            />
          )}

          {/* Cap Rate — NOI-based exit */}
          {method === 'capRate' && (
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
              helperText="Exit value = final-year NOI ÷ cap rate"
            />
          )}

          {/* Selling costs — always visible */}
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
            helperText={method === 'value' && acquisition.arv > 0
              ? `= $${Math.round(acquisition.arv * ((acquisition.exitClosingCostPct ?? 3) / 100)).toLocaleString()}`
              : 'Agent fees, transfer tax'}
          />
        </div>
      </div>

      {/* Cash-out refi — collapsible */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <button
          type="button"
          onClick={() => setRefiOpen(v => !v)}
          className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-slate-700/30 transition-colors"
        >
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">Cash-Out Refinance</span>
            {refiEnabled && !hasRefiWarning && (
              <span className="text-[10px] font-medium bg-primary-100 dark:bg-primary-900/30 text-primary-600 dark:text-primary-400 px-1.5 py-0.5 rounded-full">active</span>
            )}
            {hasRefiWarning && (
              <AlertTriangle size={13} className="text-amber-500" data-testid="refi-section-warning" />
            )}
          </div>
          <span className="text-xs text-slate-400">{refiOpen ? '▲' : '▼'}</span>
        </button>

        {refiOpen && (
          <div className="px-4 pb-4 pt-3 space-y-4 border-t border-slate-100 dark:border-slate-700">
            <label className="flex items-center gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                checked={refiEnabled}
                onChange={(e) => onRefinanceChange('enabled', e.target.checked)}
              />
              <span className="text-sm text-slate-700 dark:text-slate-300">Model a cash-out refinance</span>
            </label>

            {refiEnabled && (
              <div className="space-y-4 pl-7">
                <Input
                  label="Market Value at Refi ($)"
                  type="number"
                  fullWidth
                  min={0}
                  placeholder="e.g. 400,000"
                  value={refinance.refiMarketValue || ''}
                  onChange={(e) => onRefinanceChange('refiMarketValue', Number(e.target.value))}
                  helperText="Property value at time of refinancing"
                  warning={missingMarketValue}
                />

                <div>
                  <p className="text-xs font-medium text-slate-600 dark:text-slate-400 mb-2 flex items-center gap-1">
                    Refinance Year
                    {missingYear && <AlertTriangle size={12} className="text-amber-500 shrink-0" data-testid="refi-year-warning" />}
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {Array.from({ length: projectionYears }, (_, i) => i + 1).map(yr => (
                      <button
                        key={yr}
                        type="button"
                        onClick={() => onRefinanceChange('refiYear', yr)}
                        className={`px-3 py-1 rounded-full text-sm font-medium border transition-all ${
                          refinance.refiYear === yr
                            ? 'bg-primary-600 border-primary-600 text-white'
                            : missingYear
                              ? 'bg-white dark:bg-slate-800 border-amber-300 dark:border-amber-600 text-slate-600 dark:text-slate-400 hover:border-primary-400'
                              : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-600 text-slate-600 dark:text-slate-400 hover:border-primary-400'
                        }`}
                      >
                        Yr {yr}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="New LTV (%)"
                    type="number"
                    fullWidth
                    min={0}
                    max={100}
                    placeholder="e.g. 75"
                    value={refinance.newLTV || ''}
                    onChange={(e) => onRefinanceChange('newLTV', Number(e.target.value))}
                    helperText={refinance.refiMarketValue > 0
                      ? `= $${Math.round(refinance.refiMarketValue * (refinance.newLTV / 100)).toLocaleString()} loan`
                      : undefined}
                    warning={missingLTV}
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
                    warning={missingInterestRate}
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Input
                    label="New Loan Term (years)"
                    type="number"
                    fullWidth
                    min={1}
                    max={40}
                    placeholder="e.g. 30"
                    value={refinance.newLoanTermYears || ''}
                    onChange={(e) => onRefinanceChange('newLoanTermYears', Number(e.target.value))}
                    warning={missingLoanTerm}
                  />
                  <Input
                    label="Refi Closing Costs (%)"
                    type="number"
                    fullWidth
                    min={0}
                    max={10}
                    step={0.25}
                    placeholder="e.g. 2"
                    value={refinance.refiCostPct ?? 2}
                    onChange={(e) => onRefinanceChange('refiCostPct', Number(e.target.value))}
                    helperText={(() => {
                      const loan = refinance.refiMarketValue > 0 && refinance.newLTV > 0
                        ? refinance.refiMarketValue * (refinance.newLTV / 100)
                        : 0;
                      return loan > 0
                        ? `= $${Math.round(loan * ((refinance.refiCostPct ?? 2) / 100)).toLocaleString()}`
                        : 'Lender fees, title, etc.';
                    })()}
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
