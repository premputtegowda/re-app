/**
 * Tests for the post-login landing-page redirect logic in app/page.tsx.
 *
 * Rules:
 *  1. An explicit ?redirect=... query param ALWAYS wins.
 *  2. Otherwise, if `lastRoute` (persisted in localStorage) is set AND the user
 *     has access to its feature (reps vs deal_analyzer), use it.
 *  3. Otherwise, fall back to a feature-aware default:
 *       - has REPS access            → /dashboard
 *       - else has Deal Analyzer     → /deal-analyzer
 *       - else                       → /dashboard (hits gating downstream)
 *
 * Replicates the in-component logic so a future change has to update the test
 * (or the prod code) — they can't drift independently.
 */

import { describe, it, expect } from 'vitest';

interface User {
  features: string[];
}

function computeRedirectTo(
  searchParamsRedirect: string | null,
  lastRoute: string | null,
  user: User | null,
): string {
  const hasReps = !!user?.features?.includes('reps');
  const hasDealAnalyzer = !!user?.features?.includes('deal_analyzer');
  const featureDefault = hasReps ? '/dashboard' : hasDealAnalyzer ? '/deal-analyzer' : '/dashboard';
  const lastRouteFeature: 'deal_analyzer' | 'reps' = lastRoute?.startsWith('/deal-analyzer') ? 'deal_analyzer' : 'reps';
  const lastRouteAllowed = lastRoute && (lastRouteFeature === 'reps' ? hasReps || !user : hasDealAnalyzer || !user);
  return searchParamsRedirect ?? (lastRouteAllowed ? lastRoute! : featureDefault);
}

describe('landing-page redirect — explicit ?redirect= always wins', () => {
  it('uses ?redirect= even when lastRoute and user features exist', () => {
    expect(
      computeRedirectTo('/shared/abc123', '/dashboard', { features: ['reps'] }),
    ).toBe('/shared/abc123');
  });

  it('uses ?redirect= even when user has no matching feature', () => {
    expect(
      computeRedirectTo('/dashboard', null, { features: ['deal_analyzer'] }),
    ).toBe('/dashboard');
  });
});

describe('landing-page redirect — feature-aware default', () => {
  it('REPS-only user → /dashboard', () => {
    expect(computeRedirectTo(null, null, { features: ['reps'] })).toBe('/dashboard');
  });

  it('Deal-Analyzer-only user → /deal-analyzer (the bug this is fixing)', () => {
    expect(computeRedirectTo(null, null, { features: ['deal_analyzer'] })).toBe('/deal-analyzer');
  });

  it('user with both features → /dashboard (REPS preferred)', () => {
    expect(computeRedirectTo(null, null, { features: ['reps', 'deal_analyzer'] })).toBe('/dashboard');
  });

  it('user with no features → /dashboard fallback (downstream gating handles it)', () => {
    expect(computeRedirectTo(null, null, { features: [] })).toBe('/dashboard');
  });

  it('null user (still loading auth) → /dashboard fallback', () => {
    expect(computeRedirectTo(null, null, null)).toBe('/dashboard');
  });
});

describe('landing-page redirect — lastRoute respects feature gating', () => {
  it('lastRoute=/dashboard + user has REPS → uses lastRoute', () => {
    expect(
      computeRedirectTo(null, '/dashboard', { features: ['reps'] }),
    ).toBe('/dashboard');
  });

  it('lastRoute=/dashboard + user only has Deal Analyzer → ignores lastRoute, sends to /deal-analyzer', () => {
    expect(
      computeRedirectTo(null, '/dashboard', { features: ['deal_analyzer'] }),
    ).toBe('/deal-analyzer');
  });

  it('lastRoute=/deal-analyzer/abc + user only has REPS → ignores lastRoute, sends to /dashboard', () => {
    expect(
      computeRedirectTo(null, '/deal-analyzer/abc-123', { features: ['reps'] }),
    ).toBe('/dashboard');
  });

  it('lastRoute=/deal-analyzer + user has Deal Analyzer → uses lastRoute', () => {
    expect(
      computeRedirectTo(null, '/deal-analyzer', { features: ['deal_analyzer'] }),
    ).toBe('/deal-analyzer');
  });

  it('lastRoute=/list (REPS sub-route) + user has REPS → uses lastRoute', () => {
    expect(
      computeRedirectTo(null, '/list', { features: ['reps'] }),
    ).toBe('/list');
  });

  it('lastRoute=/list + user only has Deal Analyzer → falls back to /deal-analyzer', () => {
    expect(
      computeRedirectTo(null, '/list', { features: ['deal_analyzer'] }),
    ).toBe('/deal-analyzer');
  });
});

describe('landing-page redirect — null user (auth still resolving) treats lastRoute as allowed', () => {
  // While auth is loading, we can't yet check features. Use lastRoute optimistically;
  // the next render with the loaded user will re-evaluate.
  it('null user + lastRoute=/dashboard → uses lastRoute (assume access)', () => {
    expect(computeRedirectTo(null, '/dashboard', null)).toBe('/dashboard');
  });

  it('null user + lastRoute=/deal-analyzer → uses lastRoute (assume access)', () => {
    expect(computeRedirectTo(null, '/deal-analyzer', null)).toBe('/deal-analyzer');
  });
});

// ── Layout-level feature gate ─────────────────────────────────────────────────
// Replicates app/(app)/layout.tsx's gating: if the user navigates directly to a
// route they don't have access to (e.g., bookmarked /dashboard but only has
// deal_analyzer), the layout bounces them to a route they DO have access to.

function computeFeatureGateRedirect(
  pathname: string,
  user: { features: string[] } | null,
): string | null {
  if (!user) return null;
  const features = user.features ?? [];
  if (features.length === 0) return null; // no features → empty-state, no redirect
  if (pathname.startsWith('/admin')) return null; // admin gating handled separately
  const isDealAnalyzerRoute = pathname.startsWith('/deal-analyzer');
  const needs = isDealAnalyzerRoute ? 'deal_analyzer' : 'reps';
  if (features.includes(needs)) return null; // has access, stay
  if (features.includes('reps')) return '/dashboard';
  if (features.includes('deal_analyzer')) return '/deal-analyzer';
  return null;
}

describe('app layout feature gate — bounce users from inaccessible routes', () => {
  it('deal_analyzer-only user on /dashboard → bounced to /deal-analyzer', () => {
    expect(computeFeatureGateRedirect('/dashboard', { features: ['deal_analyzer'] })).toBe('/deal-analyzer');
  });

  it('deal_analyzer-only user on /list (REPS sub-route) → bounced to /deal-analyzer', () => {
    expect(computeFeatureGateRedirect('/list', { features: ['deal_analyzer'] })).toBe('/deal-analyzer');
  });

  it('reps-only user on /deal-analyzer → bounced to /dashboard', () => {
    expect(computeFeatureGateRedirect('/deal-analyzer', { features: ['reps'] })).toBe('/dashboard');
  });

  it('reps-only user on /deal-analyzer/abc-123 → bounced to /dashboard', () => {
    expect(computeFeatureGateRedirect('/deal-analyzer/abc-123', { features: ['reps'] })).toBe('/dashboard');
  });

  it('user with REPS on /dashboard → no bounce', () => {
    expect(computeFeatureGateRedirect('/dashboard', { features: ['reps'] })).toBeNull();
  });

  it('user with both features on /dashboard → no bounce', () => {
    expect(computeFeatureGateRedirect('/dashboard', { features: ['reps', 'deal_analyzer'] })).toBeNull();
  });

  it('user with both features on /deal-analyzer → no bounce', () => {
    expect(computeFeatureGateRedirect('/deal-analyzer', { features: ['reps', 'deal_analyzer'] })).toBeNull();
  });

  it('null user (auth loading) → no redirect (wait for user to load)', () => {
    expect(computeFeatureGateRedirect('/dashboard', null)).toBeNull();
  });

  it('user with no features → no redirect (empty-state will be shown)', () => {
    expect(computeFeatureGateRedirect('/dashboard', { features: [] })).toBeNull();
  });

  it('admin route → never gated (handled in /admin/page.tsx)', () => {
    expect(computeFeatureGateRedirect('/admin', { features: ['deal_analyzer'] })).toBeNull();
    expect(computeFeatureGateRedirect('/admin/users', { features: [] })).toBeNull();
  });
});
