'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CoCAcquisition,
  CoCOperations,
  CoCRefinance,
  ProFormaData,
  CalcPersistedState,
} from '@/types';
import { defaultProForma } from './ProFormaGrid';

// Transactional edit-session for the wizard. While a step is being edited,
// all mutations to the four deal slices (plus isValueAdd/calcState, which
// participate in the same transaction) are held as a local draft. Done
// promotes the draft upward via onCommit; Cancel unmounts the session and
// the draft evaporates — no restore logic, no ref-rewind dance.
//
// Derived-state effects (rent-sync, exit-method auto-set, proForma reset on
// property-type change, CapEx recalculation on unit-count change) live
// inside this session so that the "last seen" useRefs they depend on
// (prevPropertyType, prevWasLargeMFR, prevUnitCount) also have the
// session's lifetime. Unmount = refs die = no stale-transition bug on the
// next edit.

export interface WizardEditSessionDraft {
  acquisition: CoCAcquisition;
  proForma:    ProFormaData;
  refinance:   CoCRefinance;
  operations:  CoCOperations;
  isValueAdd:  boolean | null;
  calcState:   CalcPersistedState | null;
}

export interface WizardEditSessionSetters {
  setAcquisition: (updater: (prev: CoCAcquisition) => CoCAcquisition) => void;
  setProForma:    (updater: (prev: ProFormaData)    => ProFormaData)    => void;
  setRefinance:   (updater: (prev: CoCRefinance)    => CoCRefinance)    => void;
  setOperations:  (updater: (prev: CoCOperations)   => CoCOperations)   => void;
  setIsValueAdd:  (value: boolean | null) => void;
  setCalcState:   (value: CalcPersistedState | null) => void;
  /** Commit the current draft upward. Parent is expected to call its Zustand
   *  persistence path; session will not unmount on commit (parent controls). */
  commit: () => void;
  /** Discard the draft. Parent is expected to unmount the session. */
  cancel: () => void;
}

export interface WizardEditSessionDefaults {
  propertyMgmtPct: number;
  capExPerUnit:    number;
  maintenancePct:  number;
}

export interface WizardEditSessionProps {
  /** Initial draft — snapshotted from committed state at edit-entry time. */
  initial: WizardEditSessionDraft;
  /** Called when the user (or step logic) commits the draft. Parent merges
   *  the draft into its committed state and handles Zustand persistence. */
  onCommit: (draft: WizardEditSessionDraft) => void;
  /** Called when the user cancels. Parent should unmount this session. */
  onCancel: () => void;
  /** Rent-sync effect respects `preStabMethod === 'calculator'` to avoid
   *  stomping on calculator-driven year overrides. */
  preStabMethod: 'calculator' | 'manual' | null;
  /** Profile-scoped defaults used by the proForma-reset and CapEx effects. */
  defaults: WizardEditSessionDefaults;
  /** Render-prop: receives the live draft and scoped setters. */
  children: (
    draft: WizardEditSessionDraft,
    setters: WizardEditSessionSetters,
  ) => React.ReactNode;
}

export function WizardEditSession({ initial, onCommit, onCancel, preStabMethod, defaults, children }: WizardEditSessionProps) {
  // Draft lives in a ref so `commit()` sees the freshest value even when
  // invoked synchronously after a setter. useState is used only to trigger
  // re-renders — its value is not the source of truth.
  const draftRef = useRef<WizardEditSessionDraft>(initial);
  const [, setTick] = useState(0);
  const rerender = useCallback(() => setTick(t => t + 1), []);

  const setAcquisition = useCallback((updater: (prev: CoCAcquisition) => CoCAcquisition) => {
    draftRef.current = { ...draftRef.current, acquisition: updater(draftRef.current.acquisition) };
    rerender();
  }, [rerender]);
  const setProForma = useCallback((updater: (prev: ProFormaData) => ProFormaData) => {
    draftRef.current = { ...draftRef.current, proForma: updater(draftRef.current.proForma) };
    rerender();
  }, [rerender]);
  const setRefinance = useCallback((updater: (prev: CoCRefinance) => CoCRefinance) => {
    draftRef.current = { ...draftRef.current, refinance: updater(draftRef.current.refinance) };
    rerender();
  }, [rerender]);
  const setOperations = useCallback((updater: (prev: CoCOperations) => CoCOperations) => {
    draftRef.current = { ...draftRef.current, operations: updater(draftRef.current.operations) };
    rerender();
  }, [rerender]);
  const setIsValueAdd = useCallback((value: boolean | null) => {
    draftRef.current = { ...draftRef.current, isValueAdd: value };
    rerender();
  }, [rerender]);
  const setCalcState = useCallback((value: CalcPersistedState | null) => {
    draftRef.current = { ...draftRef.current, calcState: value };
    rerender();
  }, [rerender]);

  const commit = useCallback(() => { onCommit(draftRef.current); }, [onCommit]);
  const cancel = useCallback(() => { onCancel(); }, [onCancel]);

  // Snapshot the latest draft once per render so useEffect deps see stable
  // (by-value) primitives and React's change-detection works normally.
  const draft = draftRef.current;
  const { acquisition, proForma } = draft;
  const totalMFRUnits = acquisition.unitMix.reduce((sum, e) => sum + e.count, 0);

  // ── Effect 1: rent & proForma sync when rent fields change ─────────────
  // Deps: acquisition rent inputs + preStabMethod.
  useEffect(() => {
    const applyRentOverrides = (
      prev: ProFormaData,
      preStabAnnual: number,
      targetAnnual: number,
    ): ProFormaData['yearOverrides'] => {
      const ovs = { ...(prev.yearOverrides ?? {}) };
      if (preStabAnnual > 0) {
        ovs[1] = { ...ovs[1], grossRent: preStabAnnual, grossRentSystem: true };
      } else {
        if (ovs[1]) {
          const { grossRent: _r, grossRentSystem: _s, ...rest } = ovs[1];
          ovs[1] = Object.keys(rest).length ? rest : undefined as never;
          if (!ovs[1]) delete ovs[1];
        }
      }
      if (ovs[2]) {
        const yr2StabilizingFromCalc = ovs[2]?.grossRentSystem === true &&
          typeof ovs[2]?.grossRent === 'number' &&
          targetAnnual > 0 &&
          ovs[2].grossRent < targetAnnual;
        if (!yr2StabilizingFromCalc) {
          const { grossRent: _r, grossRentSystem: _s, ...rest } = ovs[2];
          ovs[2] = Object.keys(rest).length ? rest : undefined as never;
          if (!ovs[2]) delete ovs[2];
        }
      }
      return ovs;
    };

    if (acquisition.propertyType === 'mfr' && acquisition.unitMix.length > 0) {
      const totalTarget  = acquisition.unitMix.reduce((sum, e) => sum + e.count * (e.rentMonthly  || 0), 0);
      const totalInPlace = acquisition.unitMix.reduce((sum, e) => sum + e.count * (e.inPlaceRent  || 0), 0);
      const totalPreStab = acquisition.unitMix.reduce((sum, e) => sum + e.count * (e.preStabRent  || 0), 0);
      const allHaveTarget  = acquisition.unitMix.every((e) => (e.rentMonthly || 0) > 0);
      const allHaveInPlace = acquisition.unitMix.every((e) => (e.inPlaceRent || 0) > 0);

      setOperations(prev => ({ ...prev, grossRentMonthly: totalTarget }));
      setProForma(prev => {
        const preStabAnnual = preStabMethod === 'calculator' ? 0 : totalPreStab * 12;
        const targetAnnual = allHaveTarget ? totalTarget * 12 : 0;
        const preserveCalcOverrides = preStabAnnual === 0 &&
          Object.values(prev.yearOverrides ?? {}).some(ov => ov?.grossRentSystem === true);
        return {
          ...prev,
          grossRent: {
            ...prev.grossRent,
            ...(allHaveTarget  ? { stabilized: totalTarget * 12 } : { stabilized: 0 }),
            ...(allHaveInPlace ? { t12: totalInPlace * 12 }       : { t12: 0 }),
          },
          yearOverrides: preserveCalcOverrides
            ? prev.yearOverrides
            : applyRentOverrides(prev, preStabAnnual, targetAnnual),
        };
      });
    } else if (acquisition.propertyType === 'sfr') {
      const target  = acquisition.sfrTargetRent  || 0;
      const inPlace = acquisition.sfrInPlaceRent || 0;
      const preStab = acquisition.sfrPreStabRent || 0;
      if (target > 0) setOperations(prev => ({ ...prev, grossRentMonthly: target }));
      setProForma(prev => {
        const preStabAnnual = preStabMethod === 'calculator' ? 0 : preStab * 12;
        const preserveCalcOverrides = preStabAnnual === 0 &&
          Object.values(prev.yearOverrides ?? {}).some(ov => ov?.grossRentSystem === true);
        return {
          ...prev,
          grossRent: {
            ...prev.grossRent,
            stabilized: target  > 0 ? target  * 12 : prev.grossRent.stabilized,
            t12:        inPlace > 0 ? inPlace * 12 : prev.grossRent.t12,
          },
          yearOverrides: preserveCalcOverrides
            ? prev.yearOverrides
            : applyRentOverrides(prev, preStabAnnual, target * 12),
        };
      });
    }
  }, [acquisition.unitMix, acquisition.propertyType, acquisition.sfrTargetRent, acquisition.sfrInPlaceRent, acquisition.sfrPreStabRent, preStabMethod, setOperations, setProForma]);

  // ── Effect 2: auto-set exitMethod on MFR unit-count threshold ─────────
  // prevWasLargeMFR lives for the session's lifetime — unmount wipes it,
  // so the next edit session sees a fresh "last known" derived from the
  // committed state.
  const prevWasLargeMFR = useRef(acquisition.propertyType === 'mfr' && totalMFRUnits > 4);
  useEffect(() => {
    const isLargeMFR = acquisition.propertyType === 'mfr' && totalMFRUnits > 4;
    if (isLargeMFR && !prevWasLargeMFR.current) {
      setAcquisition(a => ({ ...a, exitMethod: 'capRate' }));
    } else if (!isLargeMFR && prevWasLargeMFR.current) {
      setAcquisition(a => ({ ...a, exitMethod: 'value' }));
    }
    prevWasLargeMFR.current = isLargeMFR;
  }, [acquisition.propertyType, totalMFRUnits, setAcquisition]);

  // ── Effect 3: reset proForma defaults when propertyType changes ───────
  const prevPropertyType = useRef(acquisition.propertyType);
  useEffect(() => {
    if (acquisition.propertyType === prevPropertyType.current) return;
    prevPropertyType.current = acquisition.propertyType;
    const units = acquisition.propertyType === 'mfr' ? Math.max(1, totalMFRUnits) : 1;
    setProForma(() => defaultProForma(acquisition.propertyType, {
      propertyMgmtPct: defaults.propertyMgmtPct,
      capExPerUnit:    defaults.capExPerUnit,
      maintenancePct:  defaults.maintenancePct,
      units,
    }));
  }, [acquisition.propertyType, totalMFRUnits, defaults.propertyMgmtPct, defaults.capExPerUnit, defaults.maintenancePct, setProForma]);

  // ── Effect 4: recalc CapEx Reserves line when unit count changes ──────
  const prevUnitCount = useRef(acquisition.propertyType === 'mfr' ? totalMFRUnits : 1);
  useEffect(() => {
    const units = acquisition.propertyType === 'mfr' ? Math.max(1, totalMFRUnits) : 1;
    if (units === prevUnitCount.current) return;
    prevUnitCount.current = units;
    setProForma(prev => ({
      ...prev,
      expenses: prev.expenses.map(e =>
        e.name === 'CapEx Reserves' && !e.isPercentOfEGI
          ? { ...e, stabilizedValue: defaults.capExPerUnit * units }
          : e,
      ),
    }));
  }, [acquisition.propertyType, totalMFRUnits, defaults.capExPerUnit, setProForma]);

  // Referenced by tests/readers that want to observe the current proForma
  // value without digging through the render prop. (Intentionally unused in
  // the render — the render prop is the supported API.)
  void proForma;

  const setters: WizardEditSessionSetters = {
    setAcquisition, setProForma, setRefinance, setOperations,
    setIsValueAdd, setCalcState, commit, cancel,
  };

  return <>{children(draft, setters)}</>;
}
