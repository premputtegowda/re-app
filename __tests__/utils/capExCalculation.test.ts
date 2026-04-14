/**
 * Tests for CapEx Reserves calculation logic.
 *
 * CapEx = capExPerUnit × total units
 * - SFR: always 1 unit
 * - MFR: sum of unitMix.count entries
 * - Recalculates when unit count changes
 * - Uses defaultProForma for initial calculation
 */

import { describe, it, expect } from 'vitest';
import { defaultProForma } from '@/components/DealAnalyzer/ProFormaGrid';

describe('CapEx Reserves calculation', () => {
  const capExPerUnit = 500;

  describe('defaultProForma initialization', () => {
    it('SFR: CapEx = capExPerUnit × 1', () => {
      const pf = defaultProForma('sfr', { capExPerUnit, units: 1, propertyMgmtPct: 8, maintenancePct: 5 });
      const capEx = pf.expenses.find(e => e.name === 'CapEx Reserves');
      expect(capEx).toBeDefined();
      expect(capEx!.stabilizedValue).toBe(500);
    });

    it('MFR 4 units: CapEx = capExPerUnit × 4', () => {
      const pf = defaultProForma('mfr', { capExPerUnit, units: 4, propertyMgmtPct: 8, maintenancePct: 5 });
      const capEx = pf.expenses.find(e => e.name === 'CapEx Reserves');
      expect(capEx!.stabilizedValue).toBe(2000);
    });

    it('MFR 10 units: CapEx = capExPerUnit × 10', () => {
      const pf = defaultProForma('mfr', { capExPerUnit, units: 10, propertyMgmtPct: 8, maintenancePct: 5 });
      const capEx = pf.expenses.find(e => e.name === 'CapEx Reserves');
      expect(capEx!.stabilizedValue).toBe(5000);
    });

    it('MFR 1 unit: CapEx = capExPerUnit × 1', () => {
      const pf = defaultProForma('mfr', { capExPerUnit, units: 1, propertyMgmtPct: 8, maintenancePct: 5 });
      const capEx = pf.expenses.find(e => e.name === 'CapEx Reserves');
      expect(capEx!.stabilizedValue).toBe(500);
    });

    it('no defaults: CapEx = 0 (preset default)', () => {
      const pf = defaultProForma('sfr');
      const capEx = pf.expenses.find(e => e.name === 'CapEx Reserves');
      expect(capEx!.stabilizedValue).toBe(0);
    });
  });

  describe('CapEx recalculation on unit count change', () => {
    // Simulates the useEffect logic in DealAnalyzerForm
    function recalcCapEx(expenses: typeof defaultProForma extends (...args: any[]) => infer R ? R['expenses'] : never, newUnits: number, capExPerUnit: number) {
      return expenses.map(e =>
        e.name === 'CapEx Reserves' && !e.isPercentOfEGI
          ? { ...e, stabilizedValue: capExPerUnit * newUnits }
          : e
      );
    }

    it('updates CapEx when units increase from 4 to 8', () => {
      const pf = defaultProForma('mfr', { capExPerUnit, units: 4, propertyMgmtPct: 8, maintenancePct: 5 });
      const updated = recalcCapEx(pf.expenses, 8, capExPerUnit);
      const capEx = updated.find(e => e.name === 'CapEx Reserves');
      expect(capEx!.stabilizedValue).toBe(4000);
    });

    it('updates CapEx when units decrease from 10 to 2', () => {
      const pf = defaultProForma('mfr', { capExPerUnit, units: 10, propertyMgmtPct: 8, maintenancePct: 5 });
      const updated = recalcCapEx(pf.expenses, 2, capExPerUnit);
      const capEx = updated.find(e => e.name === 'CapEx Reserves');
      expect(capEx!.stabilizedValue).toBe(1000);
    });

    it('does not affect other expenses', () => {
      const pf = defaultProForma('mfr', { capExPerUnit, units: 4, propertyMgmtPct: 8, maintenancePct: 5 });
      const updated = recalcCapEx(pf.expenses, 8, capExPerUnit);
      const taxes = updated.find(e => e.name === 'Property Taxes');
      expect(taxes!.stabilizedValue).toBe(pf.expenses.find(e => e.name === 'Property Taxes')!.stabilizedValue);
    });

    it('does not affect CapEx if it was converted to % of EGI', () => {
      const pf = defaultProForma('mfr', { capExPerUnit, units: 4, propertyMgmtPct: 8, maintenancePct: 5 });
      // Simulate user converting CapEx to % of EGI
      const converted = pf.expenses.map(e =>
        e.name === 'CapEx Reserves' ? { ...e, isPercentOfEGI: true, stabilizedValue: 3 } : e
      );
      const updated = recalcCapEx(converted, 8, capExPerUnit);
      const capEx = updated.find(e => e.name === 'CapEx Reserves');
      expect(capEx!.stabilizedValue).toBe(3); // unchanged — it's % of EGI now
    });
  });

  describe('total units from unitMix', () => {
    // Simulates totalMFRUnits calculation
    function totalUnits(unitMix: { count: number }[]): number {
      return unitMix.reduce((sum, e) => sum + e.count, 0);
    }

    it('sums all unit counts', () => {
      expect(totalUnits([{ count: 2 }, { count: 4 }, { count: 1 }])).toBe(7);
    });

    it('returns 0 for empty mix', () => {
      expect(totalUnits([])).toBe(0);
    });

    it('handles single type', () => {
      expect(totalUnits([{ count: 10 }])).toBe(10);
    });
  });
});
