"""Scoring functions — pure, testable, no I/O.

The composite score is a linear equal-weight combination of z-scored
features grouped by tier. Feature sign flips a feature so "higher raw
value = more attractive investment" is uniform across all features.

Design choices per DECISIONS.md §7:
    - Pre-register equal weights. Do NOT tune weights until baseline is
      established; if equal weights don't beat baseline, change features
      not weights.
    - Cross-sectional z-score per period so scores reflect *relative*
      positioning within each fold, not absolute values.
    - Median imputation for missing features (treats "missing" as
      "at median" — neutral). Avoids dropping counties with any single
      NULL feature which would shrink the sample dramatically due to
      BPS coverage cliff and early ZORI thinness.
    - Disqualifiers set composite score to NaN so those counties are
      excluded from ranking (per DECISIONS.md "any one kills a county").
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class FeatureSpec:
    """A single feature in the scoring model.

    `sign` = +1 means higher raw value is more attractive (keep as-is
    when z-scoring). `sign` = -1 means lower is better (flip). Example:
    `permits_intensity_ratio` uses -1 because low permits vs county's
    own history = supply constrained = attractive.
    """
    column: str
    tier: str  # "tier1_demand" | "tier2_supply" | "tier3_pricing"
    sign: int  # +1 or -1


# The active feature set. Iteration history:
#
#   v1 (pre-registered per DECISIONS.md §7): tiers 1-3, contrarian theory.
#      FAILED ship — lost to momentum baseline by 0.25 Spearman.
#      Ablation identified two features actively hurting: permits_intensity_ratio
#      and rent_minus_price_growth (both contrarian bets that at 24-36mo
#      horizon fight momentum, which dominates).
#
#   v2 (Path 1, 2026-08-29): added tier4_momentum. Composite jumped from
#      +0.02 to +0.23. Still short of ship by ~0.05.
#
#   v3 (Path 1+2, 2026-08-29): dropped the two harmful contrarian features.
#      Tier 2 supply and Tier 3 pricing removed entirely. Composite now =
#      fundamentals (demand + high-wage share + wages + employment) + momentum,
#      equal-weighted across the two remaining tiers.
FEATURES: tuple[FeatureSpec, ...] = (
    # Tier 1 — demand fundamentals (all Tier 1 features retained; ablation
    # showed migration is the strongest single-feature contributor and the
    # rest are neutral-to-mildly-helpful).
    FeatureSpec("domesticmig_per_1000",       "tier1_demand",   +1),
    FeatureSpec("domesticmig_accel_3yr",      "tier1_demand",   +1),
    FeatureSpec("high_wage_share",            "tier1_demand",   +1),
    FeatureSpec("high_wage_share_yoy_chg",    "tier1_demand",   +1),
    FeatureSpec("wage_growth_yoy_demeaned",   "tier1_demand",   +1),
    FeatureSpec("emp_growth_yoy_demeaned",    "tier1_demand",   +1),
    # Tier 4 — trailing momentum. The winning signal at 24-36mo horizons.
    FeatureSpec("hpi_yoy",                    "tier4_momentum", +1),
    FeatureSpec("zori_yoy",                   "tier4_momentum", +1),
    # DROPPED v3: permits_intensity_ratio (tier2_supply, sign -1)
    # DROPPED v3: rent_minus_price_growth   (tier3_pricing,  sign +1)
    # Both had large positive ablation deltas (removing them improved
    # Spearman by 0.10-0.16). Their theoretical justification (mean-
    # reversion) doesn't fit the 24-36mo horizon.
)

TIERS = ("tier1_demand", "tier4_momentum")


def _zscore(s: pd.Series) -> pd.Series:
    """Population z-score. NaN-preserving; returns 0-filled series if
    all values equal (std=0)."""
    if s.dropna().empty:
        return pd.Series(np.nan, index=s.index)
    mu = s.mean(skipna=True)
    sigma = s.std(ddof=0, skipna=True)
    if sigma == 0 or pd.isna(sigma):
        return pd.Series(0.0, index=s.index)
    return (s - mu) / sigma


def score_period(df: pd.DataFrame) -> pd.DataFrame:
    """Score a single period's cross-section.

    Input: DataFrame with feature columns + `any_disqualifier`.
    Output: original columns + `z_<feature>` + `score_<tier>` +
            `composite_score`.
    """
    out = df.copy()

    # Z-score each feature within this period. Median-impute NaNs first
    # so counties with partial coverage still get a score.
    for spec in FEATURES:
        if spec.column not in out.columns:
            continue
        raw = out[spec.column]
        imputed = raw.fillna(raw.median(skipna=True))
        out[f"z_{spec.column}"] = spec.sign * _zscore(imputed)

    # Tier averages — mean of the z-scored feature columns in that tier.
    for tier in TIERS:
        tier_zcols = [
            f"z_{s.column}" for s in FEATURES
            if s.tier == tier and f"z_{s.column}" in out.columns
        ]
        if tier_zcols:
            out[f"score_{tier}"] = out[tier_zcols].mean(axis=1)
        else:
            out[f"score_{tier}"] = np.nan

    # Composite = equal-weighted mean of tier scores (each tier equal
    # weight, regardless of how many features feed it). This matters
    # because tier2 has 1 feature and tier1 has 6 — a naive
    # feature-level mean would let tier1 dominate.
    out["composite_score"] = out[[f"score_{t}" for t in TIERS]].mean(axis=1)

    # Disqualifier mask: any_disqualifier=true → composite=NaN → excluded
    # from ranking. Do NOT set to a large negative number — that would
    # bias downstream correlation calcs.
    if "any_disqualifier" in out.columns:
        disq_mask = out["any_disqualifier"] == True  # noqa: E712 pandas boolean
        out.loc[disq_mask, "composite_score"] = np.nan

    # Rank within the period. Higher score = rank 1 (best).
    out["composite_rank"] = out["composite_score"].rank(
        ascending=False, method="min", na_option="bottom"
    ).astype("Int64")

    return out


def score_all_periods(df: pd.DataFrame) -> pd.DataFrame:
    """Apply score_period to every period_end_date in df.

    Uses an explicit loop instead of groupby().apply() because pandas 2.2+
    excludes the group key from the group DataFrame by default, which
    would strip `period_end_date` from what score_period sees. The loop
    keeps every column intact and produces the same result.
    """
    return pd.concat(
        [score_period(group) for _period, group in df.groupby("period_end_date")],
        ignore_index=False,
    )
