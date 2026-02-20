'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Card } from '@/components/UI/Card';
import { Input } from '@/components/UI/Input';
import { Select } from '@/components/UI/Select';
import { Button } from '@/components/UI/Button';
import { formatCurrency } from '@/utils/cashOnCashCalc';
import type { CoCScenario, CoCScenarioType, CoCCostItem } from '@/types';

const newItem = (): CoCCostItem => ({
  id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  description: '',
  amount: 0,
});

const DEFAULT_ACQUISITION = {
  propertyAddress: '',
  propertyType: 'sfr' as const,
  units: 1,
  purchasePrice: 300000,
  arv: 350000,
  downPaymentPct: 20,
  closingCostsPct: 2,
  points: 0,
  hardCostItems: [] as CoCCostItem[],
  softCostItems: [] as CoCCostItem[],
  opportunityCostItems: [] as CoCCostItem[],
  renovationMonths: 0,
  interestRate: 7,
  loanTermYears: 30,
  ioPeriodMonths: 0,
  stabilizedMonth: 1,
  projectionYears: 5,
};

const DEFAULT_OPERATIONS = {
  grossRentMonthly: 2000,
  vacancyRatePct: 5,
  opexPct: 30,
  propertyMgmtPct: 8,
  annualRentGrowthPct: 3,
};

const DEFAULT_REFINANCE = {
  enabled: false,
  refiYear: 3,
  newLTV: 75,
  newInterestRate: 6.5,
  newLoanTermYears: 30,
};

// ── Cost item list sub-component ──────────────────────────────────────────────

interface CostItemListProps {
  items: CoCCostItem[];
  placeholder: string;
  onAdd: () => void;
  onUpdate: (id: string, field: 'description' | 'amount', value: string | number) => void;
  onRemove: (id: string) => void;
}

function CostItemList({ items, placeholder, onAdd, onUpdate, onRemove }: CostItemListProps) {
  const total = items.reduce((sum, item) => sum + item.amount, 0);

  return (
    <div className="space-y-2">
      {items.length > 0 && (
        <div className="space-y-2">
          {/* Column headers */}
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

          {/* Running total */}
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

// ── Main form ─────────────────────────────────────────────────────────────────

interface ScenarioFormProps {
  defaultValues?: Partial<CoCScenario>;
  scenarioType: CoCScenarioType;
  onCalculate: (scenario: CoCScenario) => void;
}

export function ScenarioForm({ defaultValues, scenarioType, onCalculate }: ScenarioFormProps) {
  const [acquisition, setAcquisition] = useState({
    ...DEFAULT_ACQUISITION,
    ...defaultValues?.acquisition,
  });
  const [operations, setOperations] = useState({
    ...DEFAULT_OPERATIONS,
    ...defaultValues?.operations,
  });
  const [refinance, setRefinance] = useState({
    ...DEFAULT_REFINANCE,
    ...defaultValues?.refinance,
  });
  const [errors, setErrors] = useState<string[]>([]);

  // ── Acquisition field updater ──
  const updateAcquisition = (field: string, value: string | number) => {
    setAcquisition((prev) => ({ ...prev, [field]: value }));
  };

  // ── Hard cost item handlers ──
  const addHardCost = () =>
    setAcquisition((prev) => ({ ...prev, hardCostItems: [...prev.hardCostItems, newItem()] }));

  const updateHardCost = (id: string, field: 'description' | 'amount', value: string | number) =>
    setAcquisition((prev) => ({
      ...prev,
      hardCostItems: prev.hardCostItems.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      ),
    }));

  const removeHardCost = (id: string) =>
    setAcquisition((prev) => ({
      ...prev,
      hardCostItems: prev.hardCostItems.filter((item) => item.id !== id),
    }));

  // ── Soft cost item handlers ──
  const addSoftCost = () =>
    setAcquisition((prev) => ({ ...prev, softCostItems: [...prev.softCostItems, newItem()] }));

  const updateSoftCost = (id: string, field: 'description' | 'amount', value: string | number) =>
    setAcquisition((prev) => ({
      ...prev,
      softCostItems: prev.softCostItems.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      ),
    }));

  const removeSoftCost = (id: string) =>
    setAcquisition((prev) => ({
      ...prev,
      softCostItems: prev.softCostItems.filter((item) => item.id !== id),
    }));

  // ── Opportunity cost item handlers ──
  const addOpportunityCost = () =>
    setAcquisition((prev) => ({
      ...prev,
      opportunityCostItems: [...prev.opportunityCostItems, newItem()],
    }));

  const updateOpportunityCost = (
    id: string,
    field: 'description' | 'amount',
    value: string | number
  ) =>
    setAcquisition((prev) => ({
      ...prev,
      opportunityCostItems: prev.opportunityCostItems.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      ),
    }));

  const removeOpportunityCost = (id: string) =>
    setAcquisition((prev) => ({
      ...prev,
      opportunityCostItems: prev.opportunityCostItems.filter((item) => item.id !== id),
    }));

  const updateOperations = (field: string, value: number) =>
    setOperations((prev) => ({ ...prev, [field]: value }));

  const updateRefinance = (field: string, value: number | boolean) =>
    setRefinance((prev) => ({ ...prev, [field]: value }));

  // ── Validation ──
  const validate = (): string[] => {
    const errs: string[] = [];
    if (acquisition.purchasePrice <= 0) errs.push('Purchase price must be greater than 0');
    if (acquisition.downPaymentPct < 0 || acquisition.downPaymentPct > 100)
      errs.push('Down payment must be between 0% and 100%');
    if (operations.vacancyRatePct < 0 || operations.vacancyRatePct > 100)
      errs.push('Vacancy rate must be between 0% and 100%');
    if (acquisition.projectionYears < 1 || acquisition.projectionYears > 10)
      errs.push('Projection horizon must be between 1 and 10 years');
    if (operations.grossRentMonthly <= 0) errs.push('Gross rent must be greater than 0');
    if (acquisition.interestRate < 0) errs.push('Interest rate cannot be negative');
    if (acquisition.arv <= 0) errs.push('ARV must be greater than 0');
    if (acquisition.renovationMonths < 0) errs.push('Renovation duration cannot be negative');
    return errs;
  };

  const handleCalculate = () => {
    const errs = validate();
    if (errs.length > 0) {
      setErrors(errs);
      return;
    }
    setErrors([]);

    const scenarioNames: Record<CoCScenarioType, string> = {
      base: 'Base Case',
      bull: 'Bull Case',
      bear: 'Bear Case',
    };

    onCalculate({
      id: defaultValues?.id ?? '',
      name: defaultValues?.name ?? scenarioNames[scenarioType],
      scenarioType,
      acquisition,
      operations,
      refinance,
      createdAt: defaultValues?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  };

  const projectionOptions = Array.from({ length: 10 }, (_, i) => ({
    value: String(i + 1),
    label: `${i + 1} ${i + 1 === 1 ? 'year' : 'years'}`,
  }));

  const refiYearOptions = Array.from({ length: acquisition.projectionYears }, (_, i) => ({
    value: String(i + 1),
    label: `Year ${i + 1}`,
  }));

  const hasRenovation =
    acquisition.hardCostItems.length > 0 || acquisition.softCostItems.length > 0;

  return (
    <div className="space-y-4">
      {errors.length > 0 && (
        <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-4">
          <p className="text-sm font-medium text-red-800 dark:text-red-400 mb-2">
            Please fix the following errors:
          </p>
          <ul className="list-disc list-inside space-y-1">
            {errors.map((e, i) => (
              <li key={i} className="text-sm text-red-700 dark:text-red-300">{e}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Section A — Acquisition */}
      <Card>
        <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">Acquisition</h3>
        <div className="space-y-3">
          <Input
            label="Property Address"
            type="text"
            fullWidth
            placeholder="e.g. 123 Main St, Austin TX 78701"
            value={acquisition.propertyAddress}
            onChange={(e) => updateAcquisition('propertyAddress', e.target.value)}
          />
          <div className="grid grid-cols-2 gap-3">
            <Select
              label="Property Type"
              fullWidth
              value={acquisition.propertyType}
              onChange={(e) => updateAcquisition('propertyType', e.target.value)}
              options={[
                { value: 'sfr', label: 'Single Family (SFR)' },
                { value: 'mfr', label: 'Multi-Family (MFR)' },
              ]}
            />
            {acquisition.propertyType === 'mfr' && (
              <Input
                label="Number of Units"
                type="number"
                fullWidth
                min={2}
                value={acquisition.units}
                onChange={(e) => updateAcquisition('units', Number(e.target.value))}
              />
            )}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Purchase Price ($)"
              type="number"
              fullWidth
              min={0}
              value={acquisition.purchasePrice}
              onChange={(e) => updateAcquisition('purchasePrice', Number(e.target.value))}
            />
            <Input
              label="After Repair Value / ARV ($)"
              type="number"
              fullWidth
              min={0}
              value={acquisition.arv}
              onChange={(e) => updateAcquisition('arv', Number(e.target.value))}
            />
          </div>
          <Input
            label="Down Payment (%)"
            type="number"
            fullWidth
            min={0}
            max={100}
            step={0.5}
            value={acquisition.downPaymentPct}
            onChange={(e) => updateAcquisition('downPaymentPct', Number(e.target.value))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Closing Costs (%)"
              type="number"
              fullWidth
              min={0}
              max={10}
              step={0.1}
              value={acquisition.closingCostsPct}
              onChange={(e) => updateAcquisition('closingCostsPct', Number(e.target.value))}
              helperText="% of purchase price"
            />
            <Input
              label="Loan Points"
              type="number"
              fullWidth
              min={0}
              max={10}
              step={0.25}
              value={acquisition.points}
              onChange={(e) => updateAcquisition('points', Number(e.target.value))}
              helperText="1 point = 1% of loan amount"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Interest Rate (%)"
              type="number"
              fullWidth
              min={0}
              max={30}
              step={0.1}
              value={acquisition.interestRate}
              onChange={(e) => updateAcquisition('interestRate', Number(e.target.value))}
            />
            <Input
              label="Loan Term (years)"
              type="number"
              fullWidth
              min={1}
              max={40}
              value={acquisition.loanTermYears}
              onChange={(e) => updateAcquisition('loanTermYears', Number(e.target.value))}
            />
          </div>
          <Input
            label="Interest-Only Period (months)"
            type="number"
            fullWidth
            min={0}
            value={acquisition.ioPeriodMonths}
            onChange={(e) => updateAcquisition('ioPeriodMonths', Number(e.target.value))}
            helperText="Enter 0 for a fully amortizing loan"
          />
          <Select
            label="Projection Horizon"
            fullWidth
            value={String(acquisition.projectionYears)}
            onChange={(e) => updateAcquisition('projectionYears', Number(e.target.value))}
            options={projectionOptions}
          />
        </div>
      </Card>

      {/* Section B — Renovation & Development */}
      <Card>
        <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-1">
          Renovation & Development
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Leave empty if purchasing a stabilized, move-in ready property.
        </p>

        <div className="space-y-5">
          {/* Hard Costs */}
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Hard Costs
              <span className="ml-1.5 text-xs font-normal text-slate-400">
                (labor, materials, permits, GC fees)
              </span>
            </p>
            <CostItemList
              items={acquisition.hardCostItems}
              placeholder="e.g. Framing, Roofing, HVAC…"
              onAdd={addHardCost}
              onUpdate={updateHardCost}
              onRemove={removeHardCost}
            />
          </div>

          <div className="border-t border-slate-100 dark:border-slate-700" />

          {/* Soft Costs */}
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">
              Soft Costs
              <span className="ml-1.5 text-xs font-normal text-slate-400">
                (architect, legal, engineering, inspections, carry)
              </span>
            </p>
            <CostItemList
              items={acquisition.softCostItems}
              placeholder="e.g. Architect fee, Permits, Legal…"
              onAdd={addSoftCost}
              onUpdate={updateSoftCost}
              onRemove={removeSoftCost}
            />
          </div>

          {/* Lost Opportunity Cost — always visible */}
          <div className="border-t border-slate-100 dark:border-slate-700" />
          <div>
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">
              Lost Opportunity Cost
              <span className="ml-1.5 text-xs font-normal text-slate-400">
                (costs incurred while the property is not yet generating income)
              </span>
            </p>
            <p className="text-xs text-slate-400 dark:text-slate-500 mb-3">
              e.g. lost rental revenue, utilities, insurance, property taxes, HOA, loan carry during renovation
            </p>
            <CostItemList
              items={acquisition.opportunityCostItems}
              placeholder="e.g. Lost rental revenue, Utilities…"
              onAdd={addOpportunityCost}
              onUpdate={updateOpportunityCost}
              onRemove={removeOpportunityCost}
            />
          </div>

          {/* Renovation duration — context field */}
          <Input
            label="Renovation Duration (months)"
            type="number"
            fullWidth
            min={0}
            max={60}
            value={acquisition.renovationMonths}
            onChange={(e) => updateAcquisition('renovationMonths', Number(e.target.value))}
            helperText="For reference — how long before the property stabilizes"
          />
        </div>
      </Card>

      {/* Section C — Operations */}
      <Card>
        <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">Operations</h3>
        <div className="space-y-3">
          <Input
            label="Gross Rent / Month / Unit ($)"
            type="number"
            fullWidth
            min={0}
            value={operations.grossRentMonthly}
            onChange={(e) => updateOperations('grossRentMonthly', Number(e.target.value))}
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Vacancy Rate (%)"
              type="number"
              fullWidth
              min={0}
              max={100}
              step={0.5}
              value={operations.vacancyRatePct}
              onChange={(e) => updateOperations('vacancyRatePct', Number(e.target.value))}
            />
            <Input
              label="Operating Expenses (%)"
              type="number"
              fullWidth
              min={0}
              max={100}
              step={1}
              value={operations.opexPct}
              onChange={(e) => updateOperations('opexPct', Number(e.target.value))}
              helperText="% of effective gross income"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Property Mgmt (%)"
              type="number"
              fullWidth
              min={0}
              max={30}
              step={0.5}
              value={operations.propertyMgmtPct}
              onChange={(e) => updateOperations('propertyMgmtPct', Number(e.target.value))}
              helperText="% of effective gross income"
            />
            <Input
              label="Annual Rent Growth (%)"
              type="number"
              fullWidth
              min={-10}
              max={20}
              step={0.5}
              value={operations.annualRentGrowthPct}
              onChange={(e) => updateOperations('annualRentGrowthPct', Number(e.target.value))}
            />
          </div>
        </div>
      </Card>

      {/* Section D — Cash-Out Refi */}
      <Card>
        <h3 className="text-base font-semibold text-slate-900 dark:text-white mb-4">
          Financing / Cash-Out Refi
        </h3>
        <div className="space-y-3">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              className="w-4 h-4 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
              checked={refinance.enabled}
              onChange={(e) => updateRefinance('enabled', e.target.checked)}
            />
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              Model a cash-out refinance
            </span>
          </label>

          {refinance.enabled && (
            <div className="space-y-3 pt-1">
              <Select
                label="Refinance Year"
                fullWidth
                value={String(refinance.refiYear)}
                onChange={(e) => updateRefinance('refiYear', Number(e.target.value))}
                options={refiYearOptions}
              />
              <div className="grid grid-cols-2 gap-3">
                <Input
                  label="New LTV (%)"
                  type="number"
                  fullWidth
                  min={0}
                  max={100}
                  step={1}
                  value={refinance.newLTV}
                  onChange={(e) => updateRefinance('newLTV', Number(e.target.value))}
                />
                <Input
                  label="New Interest Rate (%)"
                  type="number"
                  fullWidth
                  min={0}
                  max={30}
                  step={0.1}
                  value={refinance.newInterestRate}
                  onChange={(e) => updateRefinance('newInterestRate', Number(e.target.value))}
                />
              </div>
              <Input
                label="New Loan Term (years)"
                type="number"
                fullWidth
                min={1}
                max={40}
                value={refinance.newLoanTermYears}
                onChange={(e) => updateRefinance('newLoanTermYears', Number(e.target.value))}
              />
            </div>
          )}
        </div>
      </Card>

      <Button variant="primary" fullWidth size="lg" onClick={handleCalculate}>
        Calculate
      </Button>
    </div>
  );
}
