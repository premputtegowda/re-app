import type { ProFormaData } from '@/types';
import { makeChainedValue, makeChainedExpenseValue } from './proFormaChaining';
import { computeEGI } from './dealAnalyzerCalc';

/**
 * Returns per-year EGI and opex calculation functions for a given ProFormaData.
 * Both ProFormaGrid (display) and dealAnalyzerCalc (projections) use this so
 * there is exactly one implementation of these computations.
 */
export function makeProFormaProjector(pf: ProFormaData) {
  const chainedValue = makeChainedValue(pf.yearOverrides);
  const chainedExpenseValue = makeChainedExpenseValue(pf.yearOverrides);
  const dist = pf.leaseAnniversaryDistribution;
  const totalUnits = dist ? dist.reduce((s, n) => s + n, 0) : 0;
  // When per-type anniversary data is present, prefer it — it's more accurate when
  // unit types have different rents (the blended `dist` collapses them together).
  const byType = pf.leaseAnniversaryByType;
  const hasByType = !!byType && byType.some(t => t.distribution.some(n => n > 0));

  /**
   * Market rent for a year — pure compounding formula off the stabilized base.
   * Year N = stabilized × Π (1 + growthPct_y/100) for y=2..N.
   * Honors per-year growth-rate overrides (yearOverrides[y].grossRentGrowthPct) but
   * IGNORES per-year grossRent overrides — the calculator's pre-stab Year-1 value
   * is the actual collected rent, not market rent. This is the GPR.
   */
  function getMarketRentForYear(year: number): number {
    if (year <= 1) return pf.grossRent.stabilized;
    let value = pf.grossRent.stabilized;
    let lastGrowthPct = pf.grossRent.growthPct;
    for (let y = 2; y <= year; y++) {
      const rateOverride = pf.yearOverrides?.[y]?.grossRentGrowthPct;
      if (rateOverride !== undefined) lastGrowthPct = rateOverride;
      value = value * (1 + lastGrowthPct / 100);
    }
    return value;
  }

  /**
   * Actual collected gross rent for a year — accounts for loss to lease.
   *
   * Year 1 (and any year with a grossRent override): uses the override directly.
   * These are pre-stab values from the simulator that already capture partial rents.
   *
   * Year 2+ (no override): uses the anniversary model.
   * Each unit renews on its anniversary month. Before the anniversary, the unit
   * earns last year's rate. After, it earns the new market rate.
   *
   * If no anniversary distribution exists, falls back to market rent (no LTL).
   */
  function getGrossRentForYear(year: number): number {
    const ov = pf.yearOverrides?.[year];
    // Any explicit override (manual or system/calculator) → use as-is
    if (ov?.grossRent !== undefined) return ov.grossRent;

    const marketRent = chainedValue('grossRent', 'grossRentGrowthPct', pf.grossRent.stabilized, pf.grossRent.growthPct, year);

    // Year 1 → no LTL applied here (Year 1's actual rent comes from the simulator override)
    if (year <= 1) return marketRent;

    const growthRate = pf.grossRent.growthPct / 100;

    // Preferred path: per-type anniversary model (accurate when types have different rents)
    if (hasByType && byType) {
      let actualRent = 0;
      for (const type of byType) {
        const marketRate = type.targetRent * Math.pow(1 + growthRate, year - 1);
        const prevRate   = type.targetRent * Math.pow(1 + growthRate, year - 2);
        for (let m = 0; m < 12; m++) {
          const units = type.distribution[m] ?? 0;
          if (units === 0) continue;
          if (m === 0) {
            actualRent += units * marketRate * 12;
          } else {
            actualRent += units * (prevRate * m + marketRate * (12 - m));
          }
        }
      }
      return actualRent;
    }

    // Fallback: blended distribution (legacy / single-type deals)
    if (!dist || totalUnits === 0) return marketRent;
    const perUnitTarget = pf.grossRent.stabilized / totalUnits / 12;
    const marketRate = perUnitTarget * Math.pow(1 + growthRate, year - 1);
    const prevRate = perUnitTarget * Math.pow(1 + growthRate, year - 2);

    let actualRent = 0;
    for (let m = 0; m < 12; m++) {
      const units = dist[m] ?? 0;
      if (units === 0) continue;
      if (m === 0) {
        actualRent += units * marketRate * 12;
      } else {
        actualRent += units * (prevRate * m + marketRate * (12 - m));
      }
    }
    return actualRent;
  }

  /**
   * Loss to lease for a year = market rent − actual collected rent.
   * Applies to every year — Year 1 (where pre-stab values produce the largest LTL
   * from offline reno units, in-place rents, lease-up) and Year N (anniversary lag).
   */
  function getLossToLeaseForYear(year: number): number {
    return getMarketRentForYear(year) - getGrossRentForYear(year);
  }

  /** Split a year's market rent into LTR vs MTR/STR portions based on
   *  pf.strategyByType (parallel to leaseAnniversaryByType). If strategy info
   *  isn't present, returns everything as LTR (backward compat). */
  function marketRentByStrategy(year: number): { ltr: number; mtr: number } {
    const strategies = pf.strategyByType ?? [];
    if (!byType || byType.length === 0 || strategies.length === 0) {
      // Fallback when per-type anniversary data is missing. If strategyByType
      // tells us the deal is single-strategy, bucket the entire market rent
      // there. Without this, an MTR-only deal missing leaseAnniversaryByType
      // would fall through to LTR and the projector's EGI would apply the
      // LTR-5% vacancy instead of MTR-20%. Mixed deals with no anniversary
      // data still default to LTR (no way to split without per-type rents).
      const totalMarket = getMarketRentForYear(year);
      if (strategies.length > 0) {
        const allMtr = strategies.every((s) => s === 'MTR' || s === 'STR');
        if (allMtr) return { ltr: 0, mtr: totalMarket };
      }
      return { ltr: totalMarket, mtr: 0 };
    }
    const rateOverrides = pf.yearOverrides?.[year]?.grossRentGrowthPct;
    // Match the compounding logic used in getMarketRentForYear.
    let growthPct = pf.grossRent.growthPct;
    for (let y = 2; y <= year; y++) {
      const rateOv = pf.yearOverrides?.[y]?.grossRentGrowthPct;
      if (rateOv !== undefined) growthPct = rateOv;
    }
    void rateOverrides;
    let ltr = 0;
    let mtr = 0;
    for (let i = 0; i < byType.length; i++) {
      const type = byType[i];
      const strategy = strategies[i] ?? 'LTR';
      const totalUnits = type.distribution.reduce((s: number, n: number) => s + n, 0);
      const perUnitMarket = type.targetRent * Math.pow(1 + growthPct / 100, year - 1);
      const typeMarket = perUnitMarket * totalUnits * 12;
      if (strategy === 'MTR' || strategy === 'STR') mtr += typeMarket;
      else ltr += typeMarket;
    }
    return { ltr, mtr };
  }

  function getEGIForYear(year: number): number {
    const ov = pf.yearOverrides?.[year];
    const grossLeaseRent = getGrossRentForYear(year);
    const marketRent     = getMarketRentForYear(year);
    const other = ov?.otherIncome   !== undefined ? ov.otherIncome   : chainedValue('otherIncome',   'otherIncomeGrowthPct', pf.otherIncome.stabilized,   pf.otherIncome.growthPct,   year);
    const vac   = ov?.vacancyPct    !== undefined ? ov.vacancyPct    : chainedValue('vacancyPct',    null,                   pf.vacancyPct.stabilized,    0,                          year);
    const clv   = ov?.creditLossPct !== undefined ? ov.creditLossPct : chainedValue('creditLossPct', null,                   pf.creditLossPct.stabilized, 0,                          year);

    // Strategy-aware vacancy: apply LTR rate to LTR revenue portion and MTR
    // rate to MTR/STR revenue portion, then sum. Falls back to blended rate
    // when strategyByType isn't populated (backward-compat).
    const { ltr, mtr } = marketRentByStrategy(year);
    const hasStrategyInfo = ltr + mtr > 0 && (pf.strategyByType?.length ?? 0) > 0;
    // When MTR/STR units are present but strategy-specific rates aren't set,
    // default to 20% / 2% instead of copying the LTR rates.
    const hasMtrPresent = (pf.strategyByType ?? []).some((s) => s === 'MTR' || s === 'STR');
    const mtrDefaultVac = hasMtrPresent ? 20 : vac;
    const mtrDefaultCl  = hasMtrPresent ? 2  : clv;
    const mtrVac = ov?.vacancyMtrPct    !== undefined ? ov.vacancyMtrPct    : (pf.vacancyMtrPct?.stabilized    ?? mtrDefaultVac);
    const mtrCl  = ov?.creditLossMtrPct !== undefined ? ov.creditLossMtrPct : (pf.creditLossMtrPct?.stabilized ?? mtrDefaultCl);
    const vacancy = hasStrategyInfo
      ? ltr * (vac / 100) + mtr * (mtrVac / 100)
      : marketRent * (vac / 100);
    const creditLoss = hasStrategyInfo
      ? ltr * (clv / 100) + mtr * (mtrCl / 100)
      : marketRent * (clv / 100);
    return grossLeaseRent - vacancy - creditLoss + other;
  }

  /** Expose per-strategy EGI so callers (and internal opex calc) can apply
   *  % of EGI expenses on a per-strategy basis. Uses same haircut logic as
   *  getEGIForYear but returns the split. */
  function getEGIByStrategy(year: number): { ltr: number; mtr: number } {
    const ov = pf.yearOverrides?.[year];
    const grossLeaseRent = getGrossRentForYear(year);
    const marketRent     = getMarketRentForYear(year);
    const other = ov?.otherIncome   !== undefined ? ov.otherIncome   : chainedValue('otherIncome',   'otherIncomeGrowthPct', pf.otherIncome.stabilized,   pf.otherIncome.growthPct,   year);
    const vac   = ov?.vacancyPct    !== undefined ? ov.vacancyPct    : chainedValue('vacancyPct',    null,                   pf.vacancyPct.stabilized,    0,                          year);
    const clv   = ov?.creditLossPct !== undefined ? ov.creditLossPct : chainedValue('creditLossPct', null,                   pf.creditLossPct.stabilized, 0,                          year);
    // MTR fallbacks — default to 20% / 2% when MTR/STR is present but no
    // strategy-specific rates have been persisted yet.
    const hasMtrPresent = (pf.strategyByType ?? []).some((s) => s === 'MTR' || s === 'STR');
    const mtrDefaultVac = hasMtrPresent ? 20 : vac;
    const mtrDefaultCl  = hasMtrPresent ? 2  : clv;
    const mtrVac = ov?.vacancyMtrPct    !== undefined ? ov.vacancyMtrPct    : (pf.vacancyMtrPct?.stabilized    ?? mtrDefaultVac);
    const mtrCl  = ov?.creditLossMtrPct !== undefined ? ov.creditLossMtrPct : (pf.creditLossMtrPct?.stabilized ?? mtrDefaultCl);

    const { ltr: ltrMarket, mtr: mtrMarket } = marketRentByStrategy(year);
    const totalMarket = ltrMarket + mtrMarket;
    if (totalMarket === 0 || (pf.strategyByType?.length ?? 0) === 0) {
      // No strategy info — treat all as LTR portion
      const egi = getEGIForYear(year);
      return { ltr: egi, mtr: 0 };
    }
    const ltrShare = ltrMarket / totalMarket;
    const mtrShare = mtrMarket / totalMarket;
    // Split gross-lease-rent and other-income proportionally on market share.
    const ltrGrossLease = grossLeaseRent * ltrShare;
    const mtrGrossLease = grossLeaseRent * mtrShare;
    const ltrOther      = other * ltrShare;
    const mtrOther      = other * mtrShare;
    // Vacancy uses strategy-specific rate; credit loss uses single rate.
    const ltrVacancy    = ltrMarket * (vac / 100);
    const mtrVacancy    = mtrMarket * (mtrVac / 100);
    const ltrCreditLoss = ltrMarket * (clv / 100);
    const mtrCreditLoss = mtrMarket * (mtrCl / 100);
    void marketRent;
    return {
      ltr: ltrGrossLease - ltrVacancy - ltrCreditLoss + ltrOther,
      mtr: mtrGrossLease - mtrVacancy - mtrCreditLoss + mtrOther,
    };
  }

  /** Full per-strategy income breakdown for a year, for display in the split
   *  pro-forma grid. Splits market rent, gross rent (with LTL), vacancy, and
   *  credit loss into LTR vs MTR portions; other income stays global (it's
   *  typically laundry / parking / pet fees, not strategy-specific).
   *
   *  Per-strategy Market and Gross Rent are computed per unit type (using the
   *  anniversary model when available) so LTL is accurate for each strategy —
   *  not just a proportional split of the blended total.
   */
  function getIncomeByStrategy(year: number): {
    ltr: {
      marketRent: number; grossRent: number; lossToLease: number;
      vacancyPct: number; vacancyAmt: number;
      creditLossPct: number; creditLossAmt: number;
      egi: number;
    };
    mtr: {
      marketRent: number; grossRent: number; lossToLease: number;
      vacancyPct: number; vacancyAmt: number;
      creditLossPct: number; creditLossAmt: number;
      egi: number;
    };
    otherIncome: number;
    totalEgi: number;
    hasStrategyInfo: boolean;
    hasLtr: boolean;
    hasMtr: boolean;
  } {
    const ov = pf.yearOverrides?.[year];
    const other = ov?.otherIncome !== undefined ? ov.otherIncome
      : chainedValue('otherIncome', 'otherIncomeGrowthPct', pf.otherIncome.stabilized, pf.otherIncome.growthPct, year);
    const vac  = ov?.vacancyPct    !== undefined ? ov.vacancyPct    : chainedValue('vacancyPct',    null, pf.vacancyPct.stabilized,    0, year);
    const clv  = ov?.creditLossPct !== undefined ? ov.creditLossPct : chainedValue('creditLossPct', null, pf.creditLossPct.stabilized, 0, year);
    const strategies = pf.strategyByType ?? [];
    const hasStrategyInfo = !!byType && byType.length > 0 && strategies.length > 0;
    const hasLtr = hasStrategyInfo ? strategies.some((s) => !s || s === 'LTR') : true;
    const hasMtr = hasStrategyInfo ? strategies.some((s) => s === 'MTR' || s === 'STR') : false;

    // MTR vacancy + credit-loss fallbacks: when the property has MTR/STR units
    // but the pro-forma hasn't yet stored strategy-specific rates, use the
    // 20% / 2% defaults instead of copying the LTR rates. Otherwise the split
    // view would show LTR's vacancy % on the MTR row, which is wrong.
    const mtrDefaultVac = hasMtr ? 20 : vac;
    const mtrDefaultCl  = hasMtr ? 2  : clv;
    const mtrVac = ov?.vacancyMtrPct    !== undefined ? ov.vacancyMtrPct    : (pf.vacancyMtrPct?.stabilized    ?? mtrDefaultVac);
    const mtrCl  = ov?.creditLossMtrPct !== undefined ? ov.creditLossMtrPct : (pf.creditLossMtrPct?.stabilized ?? mtrDefaultCl);

    // Determine effective growth rate up through `year` — mirrors getMarketRentForYear.
    let growthPct = pf.grossRent.growthPct;
    for (let y = 2; y <= year; y++) {
      const rateOv = pf.yearOverrides?.[y]?.grossRentGrowthPct;
      if (rateOv !== undefined) growthPct = rateOv;
    }
    const growthRate = growthPct / 100;

    // Per-type per-strategy accumulators
    let ltrMarket = 0, mtrMarket = 0;
    let ltrGross  = 0, mtrGross  = 0;

    if (hasStrategyInfo && byType) {
      for (let i = 0; i < byType.length; i++) {
        const type = byType[i];
        const strategy = strategies[i] ?? 'LTR';
        const isMtr = strategy === 'MTR' || strategy === 'STR';
        const unitsInType = type.distribution.reduce((s: number, n: number) => s + n, 0);
        // Market rent — pure compounding
        const perUnitMarket = type.targetRent * Math.pow(1 + growthRate, year - 1);
        const typeMarket = perUnitMarket * unitsInType * 12;
        // Gross rent — anniversary model (Year 1: use market since simulator override drives it)
        let typeGross: number;
        if (year <= 1) {
          typeGross = typeMarket;
        } else {
          const marketRate = type.targetRent * Math.pow(1 + growthRate, year - 1);
          const prevRate   = type.targetRent * Math.pow(1 + growthRate, year - 2);
          typeGross = 0;
          for (let m = 0; m < 12; m++) {
            const units = type.distribution[m] ?? 0;
            if (units === 0) continue;
            if (m === 0) typeGross += units * marketRate * 12;
            else         typeGross += units * (prevRate * m + marketRate * (12 - m));
          }
        }
        if (isMtr) { mtrMarket += typeMarket; mtrGross += typeGross; }
        else       { ltrMarket += typeMarket; ltrGross += typeGross; }
      }
    } else {
      // No strategy info — everything is LTR
      ltrMarket = getMarketRentForYear(year);
      ltrGross  = getGrossRentForYear(year);
    }

    // Year-1 per-strategy gross rent uses the simulator's per-type Year-1
    // actual collection (`byType[i].yr1Gross`), which already reflects
    // pre-stab downtime + partial months. Bucket those per-type amounts by
    // strategy — no reverse-engineering needed.
    //
    // Year 2+ keeps the per-type anniversary-computed gross (already set in
    // the loop above). Only Year 1 needs the yr1Gross override.
    //
    // Fallback (older data without yr1Gross, Year 1 only): use strict LTL
    // definition `LTL = max(0, target − in_place) × units × 12` and prorate
    // the shortfall from the blended override.
    if (year === 1) {
      const ovGrossRent = pf.yearOverrides?.[year]?.grossRent;
      if (hasStrategyInfo && byType) {
        const hasYr1Gross = byType.every((t) => typeof t.yr1Gross === 'number');
        if (hasYr1Gross) {
          // Preferred path — direct per-type Year-1 gross from the simulator.
          let ltrYr1 = 0, mtrYr1 = 0;
          for (let i = 0; i < byType.length; i++) {
            const strategy = strategies[i] ?? 'LTR';
            const isMtr = strategy === 'MTR' || strategy === 'STR';
            const g = byType[i].yr1Gross ?? 0;
            if (isMtr) mtrYr1 += g;
            else       ltrYr1 += g;
          }
          ltrGross = ltrYr1;
          mtrGross = mtrYr1;
        } else if (ovGrossRent !== undefined) {
          // Fallback — approximate from LTL potentials.
          let ltrLtlPotential = 0, mtrLtlPotential = 0;
          for (let i = 0; i < byType.length; i++) {
            const type = byType[i];
            const strategy = strategies[i] ?? 'LTR';
            const isMtr = strategy === 'MTR' || strategy === 'STR';
            const inPlace = type.inPlaceRent ?? 0;
            const gap = Math.max(0, type.targetRent - inPlace);
            const unitsInType = type.distribution.reduce((s: number, n: number) => s + n, 0);
            const typeLtlPotential = gap * unitsInType * 12;
            if (isMtr) mtrLtlPotential += typeLtlPotential;
            else       ltrLtlPotential += typeLtlPotential;
          }
          const totalMarket = ltrMarket + mtrMarket;
          const actualShortfall = Math.max(0, totalMarket - ovGrossRent);
          const totalPotential = ltrLtlPotential + mtrLtlPotential;
          if (totalPotential > 0) {
            const ratio = Math.min(1, actualShortfall / totalPotential);
            ltrGross = Math.max(0, ltrMarket - ltrLtlPotential * ratio);
            mtrGross = Math.max(0, mtrMarket - mtrLtlPotential * ratio);
          } else {
            ltrGross = ltrMarket;
            mtrGross = mtrMarket;
          }
        }
      } else if (ovGrossRent !== undefined) {
        // No strategy info — everything is LTR
        ltrGross = ovGrossRent;
        mtrGross = 0;
      }
    }

    const ltrVacancyAmt    = ltrMarket * (vac    / 100);
    const mtrVacancyAmt    = mtrMarket * (mtrVac / 100);
    const ltrCreditLossAmt = ltrMarket * (clv    / 100);
    const mtrCreditLossAmt = mtrMarket * (mtrCl  / 100);
    const ltrEgi = ltrGross - ltrVacancyAmt - ltrCreditLossAmt;
    const mtrEgi = mtrGross - mtrVacancyAmt - mtrCreditLossAmt;

    return {
      ltr: {
        marketRent: ltrMarket, grossRent: ltrGross, lossToLease: ltrMarket - ltrGross,
        vacancyPct: vac, vacancyAmt: ltrVacancyAmt,
        creditLossPct: clv, creditLossAmt: ltrCreditLossAmt,
        egi: ltrEgi,
      },
      mtr: {
        marketRent: mtrMarket, grossRent: mtrGross, lossToLease: mtrMarket - mtrGross,
        vacancyPct: mtrVac, vacancyAmt: mtrVacancyAmt,
        creditLossPct: mtrCl, creditLossAmt: mtrCreditLossAmt,
        egi: mtrEgi,
      },
      otherIncome: other,
      totalEgi: ltrEgi + mtrEgi + other,
      hasStrategyInfo, hasLtr, hasMtr,
    };
  }

  /** Detect strategy targeting from an expense name suffix.
   *  " (LTR)" → applies rate to LTR EGI portion only.
   *  " (MTR)" → applies rate to MTR/STR EGI portion only.
   *  Otherwise (generic PM/R&M without suffix) → applies to total EGI. */
  function strategyForExpenseName(name: string): 'ltr' | 'mtr' | null {
    // Explicit labels win.
    if (/\(ltr\)/i.test(name)) return 'ltr';
    if (/\(mtr\)/i.test(name) || /\bmtr\b/i.test(name) || /\bstr\b/i.test(name)) return 'mtr';
    // Implicit LTR: "Property Management" and "Maintenance & Repairs" (or
    // "Repairs & Maintenance") without an MTR/STR suffix are LTR-style
    // defaults from the MFR expense template (8% PM, 5% M&R). For MTR-only
    // deals with an MTR-labeled counterpart present, these implicit LTR
    // rows should be filtered out — otherwise the same category gets
    // double-counted (LTR default + MTR-specific rate). Only PM and M&R
    // are strategy-differentiated by convention; everything else
    // ("Real Estate Taxes", "Insurance", "CapEx Reserves", contract
    // services, utilities, etc.) stays common.
    const trimmed = name.trim();
    if (/^(property\s*(mgmt|management)|management\s+fee)/i.test(trimmed)) return 'ltr';
    if (/^(maintenance\s*&\s*repairs?|repairs?\s*&\s*maintenance|r\s*&\s*m|r\s+and\s+m)/i.test(trimmed)) return 'ltr';
    return null;
  }

  function getOpExForYear(year: number, egi: number): number {
    const strategyEgi = getEGIByStrategy(year);
    // Single-strategy filter — exclude cross-strategy fixed-$ expenses so
    // the sum matches what `buildProFormaMatrix` renders in the flat grid.
    // Without this, an MTR-only deal with any LTR-labeled fixed expense
    // would over-count OpEx here vs the grid the user sees on screen.
    const strategies = pf.strategyByType ?? [];
    const hasLtr = strategies.length === 0 || strategies.some((s) => !s || s === 'LTR');
    const hasMtr = strategies.some((s) => s === 'MTR' || s === 'STR');
    const soleStrategy: 'ltr' | 'mtr' | null =
      strategies.length === 0 ? null
      : hasLtr && !hasMtr ? 'ltr'
      : !hasLtr && hasMtr ? 'mtr'
      : null;
    return pf.expenses.reduce((sum, e) => {
      const strategy = strategyForExpenseName(e.name);
      // Skip cross-strategy items in single-strategy deals.
      if (strategy !== null && soleStrategy !== null && strategy !== soleStrategy) {
        return sum;
      }
      if (e.isPercentOfEGI) {
        let pct = e.stabilizedValue;
        for (let y = 1; y <= year; y++) {
          const expOv = pf.yearOverrides?.[y]?.expenses?.[e.id];
          if (expOv !== undefined) pct = expOv;
        }
        if (strategy === 'ltr') return sum + strategyEgi.ltr * (pct / 100);
        if (strategy === 'mtr') return sum + strategyEgi.mtr * (pct / 100);
        return sum + egi * (pct / 100);
      }
      // Fixed-$ expenses are stored as ANNUAL $ (same convention across
      // pf.expenses[].stabilizedValue and pf.yearOverrides[].expenses[id]).
      const expOv = pf.yearOverrides?.[year]?.expenses?.[e.id];
      return sum + (expOv !== undefined ? expOv : chainedExpenseValue(e, year));
    }, 0);
  }

  function getEffectivePctForExpense(expenseId: string, stabilizedPct: number, year: number): number {
    let lastPct = stabilizedPct;
    for (let y = 1; y <= year; y++) {
      const expOv = pf.yearOverrides?.[y]?.expenses?.[expenseId];
      if (expOv !== undefined) lastPct = expOv;
    }
    return lastPct;
  }

  return { getMarketRentForYear, getGrossRentForYear, getLossToLeaseForYear, getEGIForYear, getEGIByStrategy, getIncomeByStrategy, getOpExForYear, getEffectivePctForExpense, strategyForExpenseName };
}
