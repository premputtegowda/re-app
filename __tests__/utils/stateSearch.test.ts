/**
 * Tests for state search: parseAddress, normalizeStateInput, matchesState
 *
 * Covers:
 *  1. parseAddress — Mapbox format, manual entry, edge cases
 *  2. normalizeStateInput — full name, abbreviation, mixed case
 *  3. matchesState — end-to-end filter matching
 *  4. Drafts included in filter results (verified by filter logic)
 */

import { describe, it, expect } from 'vitest';
import { parseAddress, normalizeStateInput, matchesState, STATE_ABBR } from '@/utils/stateSearch';

// ── parseAddress ──────────────────────────────────────────────────────────────

describe('parseAddress', () => {
  it('parses Mapbox format: "123 Main St, Austin, Texas 78701, United States"', () => {
    const { city, state } = parseAddress('123 Main St, Austin, Texas 78701, United States');
    expect(state).toBe('TX');
    expect(city).toBe('Austin');
  });

  it('parses manual entry: "123 Main St, Austin, TX 78701"', () => {
    const { city, state } = parseAddress('123 Main St, Austin, TX 78701');
    expect(state).toBe('TX');
    expect(city).toBe('Austin');
  });

  it('parses address with no zip: "123 Main St, Austin, TX"', () => {
    const { city, state } = parseAddress('123 Main St, Austin, TX');
    expect(state).toBe('TX');
    expect(city).toBe('Austin');
  });

  it('parses two-part address: "Austin, TX 78701"', () => {
    const { city, state } = parseAddress('Austin, TX 78701');
    expect(state).toBe('TX');
    expect(city).toBe('Austin');
  });

  it('parses Mapbox with full state name and no zip: "Austin, Texas, United States"', () => {
    const { city, state } = parseAddress('Austin, Texas, United States');
    expect(state).toBe('TX');
    expect(city).toBe('Austin');
  });

  it('parses two-word state name: "Charlotte, North Carolina 28202, United States"', () => {
    const { city, state } = parseAddress('Charlotte, North Carolina 28202, United States');
    expect(state).toBe('NC');
    expect(city).toBe('Charlotte');
  });

  it('parses New York: "123 Broadway, New York, New York 10001, United States"', () => {
    const { city, state } = parseAddress('123 Broadway, New York, New York 10001, United States');
    expect(state).toBe('NY');
    expect(city).toBe('New York');
  });

  it('parses DC: "1600 Pennsylvania Ave, Washington, District of Columbia 20500, United States"', () => {
    const { city, state } = parseAddress('1600 Pennsylvania Ave, Washington, District of Columbia 20500, United States');
    expect(state).toBe('DC');
    expect(city).toBe('Washington');
  });

  it('handles single-part address with abbreviation: "Austin TX 78701"', () => {
    const { city, state } = parseAddress('Austin TX 78701');
    expect(state).toBe('TX');
    expect(city).toBe('');
  });

  it('returns empty state for unrecognized address', () => {
    const { city, state } = parseAddress('Some Random Place');
    expect(state).toBe('');
  });

  it('returns empty for empty string', () => {
    const { city, state } = parseAddress('');
    expect(state).toBe('');
    expect(city).toBe('');
  });

  it('handles West Virginia (two-word state)', () => {
    const { city, state } = parseAddress('100 Main St, Charleston, West Virginia 25301, United States');
    expect(state).toBe('WV');
    expect(city).toBe('Charleston');
  });
});

// ── normalizeStateInput ───────────────────────────────────────────────────────

describe('normalizeStateInput', () => {
  it('"TX" → "TX"', () => {
    expect(normalizeStateInput('TX')).toBe('TX');
  });

  it('"tx" → "TX"', () => {
    expect(normalizeStateInput('tx')).toBe('TX');
  });

  it('"Texas" → "TX"', () => {
    expect(normalizeStateInput('Texas')).toBe('TX');
  });

  it('"texas" → "TX"', () => {
    expect(normalizeStateInput('texas')).toBe('TX');
  });

  it('"TEXAS" → "TX"', () => {
    expect(normalizeStateInput('TEXAS')).toBe('TX');
  });

  it('"  tx  " with whitespace → "TX"', () => {
    expect(normalizeStateInput('  tx  ')).toBe('TX');
  });

  it('"North Carolina" → "NC"', () => {
    expect(normalizeStateInput('North Carolina')).toBe('NC');
  });

  it('"north carolina" → "NC"', () => {
    expect(normalizeStateInput('north carolina')).toBe('NC');
  });

  it('"New York" → "NY"', () => {
    expect(normalizeStateInput('New York')).toBe('NY');
  });

  it('"district of columbia" → "DC"', () => {
    expect(normalizeStateInput('district of columbia')).toBe('DC');
  });

  it('unknown input returns uppercased: "XX" → "XX"', () => {
    expect(normalizeStateInput('XX')).toBe('XX');
  });

  it('all 50 states + DC are in STATE_ABBR', () => {
    expect(Object.keys(STATE_ABBR).length).toBe(51);
  });
});

// ── matchesState ──────────────────────────────────────────────────────────────

describe('matchesState', () => {
  const txAddress = '123 Main St, Austin, Texas 78701, United States';
  const txManual = '123 Main St, Austin, TX 78701';

  it('matches Mapbox address with "TX"', () => {
    expect(matchesState(txAddress, 'TX')).toBe(true);
  });

  it('matches Mapbox address with "tx"', () => {
    expect(matchesState(txAddress, 'tx')).toBe(true);
  });

  it('matches Mapbox address with "Texas"', () => {
    expect(matchesState(txAddress, 'Texas')).toBe(true);
  });

  it('matches Mapbox address with "texas"', () => {
    expect(matchesState(txAddress, 'texas')).toBe(true);
  });

  it('matches manual address with "TX"', () => {
    expect(matchesState(txManual, 'TX')).toBe(true);
  });

  it('matches manual address with "Texas"', () => {
    expect(matchesState(txManual, 'Texas')).toBe(true);
  });

  it('does not match wrong state', () => {
    expect(matchesState(txAddress, 'CA')).toBe(false);
    expect(matchesState(txAddress, 'California')).toBe(false);
  });

  it('empty filter matches everything', () => {
    expect(matchesState(txAddress, '')).toBe(true);
    expect(matchesState('', '')).toBe(true);
  });

  it('filter on empty address returns false', () => {
    expect(matchesState('', 'TX')).toBe(false);
  });

  it('works with two-word states', () => {
    const ncAddress = '100 Trade St, Charlotte, North Carolina 28202, United States';
    expect(matchesState(ncAddress, 'NC')).toBe(true);
    expect(matchesState(ncAddress, 'North Carolina')).toBe(true);
    expect(matchesState(ncAddress, 'north carolina')).toBe(true);
  });
});
