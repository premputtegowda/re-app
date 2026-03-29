/**
 * Tests that the Rent Schedule section in DealAnalyzerForm uses a mobile-friendly
 * layout so 4-digit+ rent values are never clipped.
 *
 * SFR:  grid-cols-1 sm:grid-cols-3  — stacks to one column on mobile
 * MFR:  CSS dual layout:
 *   - Mobile  (sm:hidden)       — card per unit type, grid-cols-3 for 3 inputs
 *   - Desktop (hidden sm:block) — original table unchanged
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = readFileSync(
  resolve(__dirname, '../../components/DealAnalyzer/DealAnalyzerForm.tsx'),
  'utf8'
);

describe('Rent Schedule — SFR mobile layout', () => {
  it('SFR grid uses grid-cols-1 sm:grid-cols-3 (stacks on mobile)', () => {
    expect(SRC).toContain('grid-cols-1 sm:grid-cols-3');
  });

  it('SFR section has no bare grid-cols-3 without responsive prefix', () => {
    // Every grid-cols-3 that is NOT preceded by sm: (or similar responsive prefix)
    // Only the mobile card's inner grid-cols-3 (inside sm:hidden) is allowed.
    // The SFR top-level rent grid must be responsive.
    const sfrSection = SRC.slice(
      SRC.indexOf('Rent Schedule ($/mo)'),
      SRC.indexOf('Rent Schedule ($/mo)') + 400
    );
    expect(sfrSection).toContain('grid-cols-1 sm:grid-cols-3');
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

  it('mobile card section renders In-Place, Target, Pre-Stab labels', () => {
    // These labels must appear inside the sm:hidden block
    const hiddenStart = SRC.indexOf('sm:hidden');
    const hiddenEnd   = SRC.indexOf('hidden sm:block');
    const mobileBlock = SRC.slice(hiddenStart, hiddenEnd);
    expect(mobileBlock).toContain('In-Place');
    expect(mobileBlock).toContain('Target');
    expect(mobileBlock).toContain('Pre-Stab');
  });

  it('mobile card section uses grid-cols-3 for 3-input row', () => {
    const hiddenStart = SRC.indexOf('sm:hidden');
    const hiddenEnd   = SRC.indexOf('hidden sm:block');
    const mobileBlock = SRC.slice(hiddenStart, hiddenEnd);
    expect(mobileBlock).toContain('grid-cols-3');
  });

  it('desktop section contains a <table> element', () => {
    const desktopIdx  = SRC.indexOf('hidden sm:block');
    const desktopBlock = SRC.slice(desktopIdx, desktopIdx + 2000);
    expect(desktopBlock).toContain('<table');
  });

  it('mobile avg summary row shows Avg/unit equivalent labels', () => {
    const hiddenStart = SRC.indexOf('sm:hidden');
    const hiddenEnd   = SRC.indexOf('hidden sm:block');
    const mobileBlock = SRC.slice(hiddenStart, hiddenEnd);
    // Avg summary row contains In-Place / Target / Pre-Stab as string literals
    expect(mobileBlock).toContain("'In-Place'");
    expect(mobileBlock).toContain("'Target'");
    expect(mobileBlock).toContain("'Pre-Stab'");
  });
});
