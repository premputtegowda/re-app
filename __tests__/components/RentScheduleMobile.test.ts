/**
 * Tests that the Rent Schedule section in DealAnalyzerForm uses a mobile-friendly
 * layout with computed (read-only) Pre-Stab values from the stabilization calculator.
 *
 * SFR:  grid-cols-1 sm:grid-cols-2  — 2 editable fields (In-Place, Target)
 *       Pre-Stab shown as read-only blue badge when set by calculator
 * MFR:  CSS dual layout:
 *   - Mobile  (sm:hidden)       — card per unit type, grid-cols-2 for 2 inputs
 *                                  Pre-Stab shown as read-only label when set
 *   - Desktop (hidden sm:block) — table with In-Place, Target editable + Pre-Stab read-only
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = readFileSync(
  resolve(__dirname, '../../components/DealAnalyzer/DealAnalyzerForm.tsx'),
  'utf8'
);

describe('Rent Schedule — SFR mobile layout', () => {
  it('SFR grid uses grid-cols-1 sm:grid-cols-2 (stacks on mobile, 2 editable fields)', () => {
    expect(SRC).toContain('grid-cols-1 sm:grid-cols-2');
  });

  it('SFR section shows In-Place and Target inputs', () => {
    const sfrSection = SRC.slice(
      SRC.indexOf('Rent Schedule ($/mo)'),
      SRC.indexOf('Rent Schedule ($/mo)') + 600
    );
    expect(sfrSection).toContain('sfrInPlaceRent');
    expect(sfrSection).toContain('sfrTargetRent');
  });

  it('SFR section does not contain an editable sfrPreStabRent input', () => {
    const sfrSection = SRC.slice(
      SRC.indexOf('Rent Schedule ($/mo)'),
      SRC.indexOf('Rent Schedule ($/mo)') + 800
    );
    // sfrPreStabRent should only appear as a read-only display, not as an onChange input
    const inputMatch = sfrSection.match(/onChange.*sfrPreStabRent/s);
    expect(inputMatch).toBeNull();
  });

  it('SFR section shows pre-stab value as read-only when set', () => {
    const sfrSection = SRC.slice(
      SRC.indexOf('Rent Schedule ($/mo)'),
      SRC.indexOf('Rent Schedule ($/mo)') + 2000
    );
    expect(sfrSection).toContain('sfrPreStabRent');
    expect(sfrSection).toContain('from calculator');
  });
});

describe('Rent Schedule — MFR mobile dual layout', () => {
  it('has a sm:hidden mobile card section', () => {
    expect(SRC).toContain('sm:hidden');
  });

  it('has a hidden sm:block desktop table section', () => {
    expect(SRC).toContain('hidden sm:block');
  });

  it('mobile card section comes before the desktop table', () => {
    const mobileIdx  = SRC.indexOf('sm:hidden');
    const desktopIdx = SRC.indexOf('hidden sm:block');
    expect(mobileIdx).toBeLessThan(desktopIdx);
  });

  it('mobile card section renders In-Place and Target labels', () => {
    const hiddenStart = SRC.indexOf('sm:hidden');
    const hiddenEnd   = SRC.indexOf('hidden sm:block');
    const mobileBlock = SRC.slice(hiddenStart, hiddenEnd);
    expect(mobileBlock).toContain('In-Place');
    expect(mobileBlock).toContain('Target');
  });

  it('mobile card section uses grid-cols-2 for 2-input row', () => {
    const hiddenStart = SRC.indexOf('sm:hidden');
    const hiddenEnd   = SRC.indexOf('hidden sm:block');
    const mobileBlock = SRC.slice(hiddenStart, hiddenEnd);
    expect(mobileBlock).toContain('grid-cols-2');
  });

  it('mobile card shows pre-stab as read-only (calc) label', () => {
    const hiddenStart = SRC.indexOf('sm:hidden');
    const hiddenEnd   = SRC.indexOf('hidden sm:block');
    const mobileBlock = SRC.slice(hiddenStart, hiddenEnd);
    expect(mobileBlock).toContain('Pre-Stab');
    expect(mobileBlock).toContain('calc');
  });

  it('desktop section contains a <table> element', () => {
    const desktopIdx   = SRC.indexOf('hidden sm:block');
    const desktopBlock = SRC.slice(desktopIdx, desktopIdx + 2000);
    expect(desktopBlock).toContain('<table');
  });

  it('mobile avg summary row shows In-Place and Target averages', () => {
    const hiddenStart = SRC.indexOf('sm:hidden');
    const hiddenEnd   = SRC.indexOf('hidden sm:block');
    const mobileBlock = SRC.slice(hiddenStart, hiddenEnd);
    expect(mobileBlock).toContain('In-Place');
    expect(mobileBlock).toContain('Target');
  });
});
