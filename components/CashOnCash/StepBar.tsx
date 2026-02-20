'use client';

import { Check } from 'lucide-react';

export interface StepDef {
  label: string;
  optional?: boolean;
}

interface StepBarProps {
  steps: StepDef[];
  currentStep: number;
  completedSteps: Set<number>;
  onStepClick: (index: number) => void;
}

export function StepBar({ steps, currentStep, completedSteps, onStepClick }: StepBarProps) {
  return (
    <>
      {/* Desktop */}
      <div className="hidden sm:flex items-start">
        {steps.map((step, i) => {
          const isActive = i === currentStep;
          const isPast = i < currentStep;
          const isCompleted = completedSteps.has(i) && !isActive;
          const isClickable = isPast || isActive || completedSteps.has(i);

          return (
            <div key={i} className="flex items-start flex-1 last:flex-none">
              <button
                type="button"
                onClick={() => isClickable && onStepClick(i)}
                className={`flex flex-col items-center min-w-0 transition-opacity ${
                  isClickable ? 'cursor-pointer' : 'cursor-default opacity-60'
                }`}
              >
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold transition-all ${
                    isActive
                      ? 'bg-primary-600 text-white ring-4 ring-primary-100 dark:ring-primary-900/40'
                      : isCompleted || isPast
                      ? 'bg-primary-600 text-white'
                      : 'bg-slate-200 dark:bg-slate-700 text-slate-500 dark:text-slate-400'
                  }`}
                >
                  {isCompleted ? <Check size={14} strokeWidth={2.5} /> : i + 1}
                </div>
                <div className="mt-1.5 text-center px-1">
                  <p
                    className={`text-xs font-medium leading-tight whitespace-nowrap ${
                      isActive
                        ? 'text-primary-600 dark:text-primary-400'
                        : isPast || isCompleted
                        ? 'text-slate-700 dark:text-slate-300'
                        : 'text-slate-400 dark:text-slate-500'
                    }`}
                  >
                    {step.label}
                  </p>
                  {step.optional && (
                    <p className="text-[10px] text-slate-400 dark:text-slate-500 leading-tight">
                      optional
                    </p>
                  )}
                </div>
              </button>

              {i < steps.length - 1 && (
                <div
                  className={`flex-1 h-0.5 mt-4 mx-1 rounded-full transition-colors ${
                    isPast || isCompleted
                      ? 'bg-primary-600'
                      : 'bg-slate-200 dark:bg-slate-700'
                  }`}
                />
              )}
            </div>
          );
        })}
      </div>

      {/* Mobile — active step label + dot progress */}
      <div className="sm:hidden">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-semibold text-slate-900 dark:text-white">
            {steps[currentStep].label}
            {steps[currentStep].optional && (
              <span className="ml-1.5 text-xs font-normal text-slate-400">(optional)</span>
            )}
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            {currentStep + 1} / {steps.length}
          </span>
        </div>
        <div className="flex gap-1">
          {steps.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => (i <= currentStep || completedSteps.has(i)) && onStepClick(i)}
              className={`h-1.5 rounded-full transition-all ${
                i === currentStep
                  ? 'bg-primary-600 flex-1'
                  : i < currentStep
                  ? 'bg-primary-400 w-4 cursor-pointer'
                  : 'bg-slate-200 dark:bg-slate-700 w-4 cursor-default'
              }`}
            />
          ))}
        </div>
      </div>
    </>
  );
}
