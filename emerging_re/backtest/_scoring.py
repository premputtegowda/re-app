"""Scoring functions — pure, testable, no I/O.

We compute THREE target-optimized composites in one pass:
    - `hpi_composite_score`   — features that empirically help HPI prediction
    - `zori_composite_score`  — features that empirically help ZORI prediction
    - `joint_composite_score` — strict intersection (features that help BOTH)

Classifications derived from v18-A ablation (2026-08-31 run). A feature
is "helpful" for a target if its leave-one-out drop delta averaged over
24mo + 36mo horizons is < 0. Features hurting both (high_wage_share,
high_wage_share_yoy_chg, fmr_2br_yoy) appear in NO composite.

Investor strategy → composite mapping:
    Cash flow / DSCR loans        → ZORI-max
    Value-add / flipper           → HPI-max
    Total return (buy-and-hold)   → JOINT

For back-compat with earlier code, `composite_score` (unqualified) is
maintained as an alias for `joint_composite_score`.

Design invariants (per DECISIONS.md §7):
    - Pre-register equal weights. Composite = mean of tier scores; tier
      score = mean of z-scored feature columns in that tier.
    - Cross-sectional z-score per period so scores reflect *relative*
      positioning within each fold.
    - Median imputation for missing features.
    - Disqualifiers set composite score to NaN → excluded from ranking.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass(frozen=True)
class FeatureSpec:
    """A single feature contribution. `sign` = +1 keep as-is, -1 flip."""
    column: str
    tier: str  # "tier1_demand" | "tier4_momentum"
    sign: int


# ── Master feature registry ──────────────────────────────────────────────
# Sign + tier assignments — the canonical source of truth. Composites
# reference features by column name; sign/tier looked up here.
_ALL_FEATURES: tuple[FeatureSpec, ...] = (
    # Tier 1 — demand fundamentals
    FeatureSpec("domesticmig_per_1000",              "tier1_demand",   +1),
    FeatureSpec("domesticmig_accel_3yr",             "tier1_demand",   +1),
    FeatureSpec("wage_growth_yoy_demeaned",          "tier1_demand",   +1),
    FeatureSpec("emp_growth_yoy_demeaned",           "tier1_demand",   +1),
    FeatureSpec("cap_rate_proxy",                    "tier1_demand",   +1),
    FeatureSpec("irs_net_migration_rate",            "tier1_demand",   +1),
    FeatureSpec("irs_inflow_rate",                   "tier1_demand",   +1),
    FeatureSpec("irs_income_gap",                    "tier1_demand",   +1),
    FeatureSpec("irs_income_gap_pct",                "tier1_demand",   +1),
    FeatureSpec("irs_net_agi_per_capita",            "tier1_demand",   +1),
    FeatureSpec("pcpi_cagr_3yr_vs_state_pp",         "tier1_demand",   +1),
    FeatureSpec("fmr_2br_cagr_3yr_vs_state_pp",      "tier1_demand",   +1),
    FeatureSpec("renter_ind_emp_yoy",                "tier1_demand",   +1),
    FeatureSpec("vt_vacancy_change_3yr",             "tier1_demand",   -1),
    FeatureSpec("vt_vacancy_change_5yr",             "tier1_demand",   -1),
    FeatureSpec("age_20_34_share_yoy_chg",           "tier1_demand",   +1),
    FeatureSpec("foreign_born_share_yoy_chg",        "tier1_demand",   +1),
    FeatureSpec("mf_permit_ratio_ts",                "tier1_demand",   -1),
    # v20 mean-reversion features TESTED + REMOVED (2026-09-01). Added to
    # address 2022 cohort miss (Vermilion IL, Broome NY etc.). Barely
    # moved 2022 in-sample and OOF ablation on TRAIN (<=2018) confirmed
    # avg_delta ~= 0 for zori_5yr_cagr_deficit and slightly positive for
    # hpi_5yr_cagr_deficit — dropping them doesn't hurt or slightly helps.
    # Kept int_rent_catchup.sql as a build artifact; nothing scores it.
    # v19 anchor-institution features TESTED + REVERTED (2026-09-01).
    # Diagnostic showed +3.9 pp ZORI 5y Q1-Q5 spread but composite
    # Spearman regressed −0.01 across all targets when added. Same
    # pattern as sector_concentration: raw-group means don't translate
    # to composite ranking improvement. Kept as DISPLAY columns in
    # mart_mf_scored for manual filtering (e.g., "buy tourism markets").
    # Tier 4 — trailing momentum
    FeatureSpec("hpi_yoy",                           "tier4_momentum", +1),
    FeatureSpec("zori_yoy",                          "tier4_momentum", +1),
)

_FEATURES_BY_COL: dict[str, FeatureSpec] = {f.column: f for f in _ALL_FEATURES}


def _subset(*column_names: str) -> tuple[FeatureSpec, ...]:
    """Look up FeatureSpecs by column name in the master registry."""
    return tuple(_FEATURES_BY_COL[c] for c in column_names)


# ── The three composites ─────────────────────────────────────────────────
# Classifications from v18-A ablation (drop_delta < 0 avg over 24mo+36mo).
# DROPPED FROM ALL COMPOSITES (hurt both targets): high_wage_share,
# high_wage_share_yoy_chg, fmr_2br_yoy.

HPI_MAX_FEATURES = _subset(
    "domesticmig_per_1000",
    "domesticmig_accel_3yr",
    "wage_growth_yoy_demeaned",
    "emp_growth_yoy_demeaned",
    "irs_net_migration_rate",
    "irs_inflow_rate",
    "irs_income_gap",
    "irs_income_gap_pct",
    "irs_net_agi_per_capita",
    "pcpi_cagr_3yr_vs_state_pp",
    "fmr_2br_cagr_3yr_vs_state_pp",
    "renter_ind_emp_yoy",
    "vt_vacancy_change_5yr",
    "age_20_34_share_yoy_chg",
    "foreign_born_share_yoy_chg",
    "hpi_yoy",
    "zori_yoy",
)

ZORI_MAX_FEATURES = _subset(
    # v21 OOF-pruned list (2026-09-01). Trained on TRAIN=<=2018-12-31.
    # These 4 are the only features where LOO drop_delta < 0 avg over ZORI
    # 24mo + 36mo targets AFTER catch-up features were removed from the
    # candidate pool. Prior v18-A list carried 11 additional features that
    # OOF ablation ranked as noise. hpi_yoy was borderline in the initial
    # OOF run and shifted to slightly positive after catch-up removal —
    # empirically it hurt 2022+ ZORI predictions by ~+0.25 Spearman and
    # ~+3.6 pp Q1-Q5 spread. HPI momentum led rent momentum 2019-2020
    # then decoupled: Sunbelt price rippers went flat on rent in 2022+.
    # Thematically cleaner too — a pure ZORI-max shouldn't use price mom.
    "domesticmig_per_1000",
    "domesticmig_accel_3yr",
    "mf_permit_ratio_ts",
    "zori_yoy",
)

JOINT_FEATURES = _subset(
    "domesticmig_per_1000",
    "domesticmig_accel_3yr",
    "irs_income_gap",
    "irs_income_gap_pct",
    "fmr_2br_cagr_3yr_vs_state_pp",
    "vt_vacancy_change_5yr",
    "age_20_34_share_yoy_chg",
    "foreign_born_share_yoy_chg",
    "hpi_yoy",
    "zori_yoy",
)


@dataclass(frozen=True)
class CompositeSpec:
    """A named composite with its feature set."""
    name: str  # "hpi" | "zori" | "joint"
    features: tuple[FeatureSpec, ...]

    @property
    def score_col(self) -> str:
        return f"{self.name}_composite_score"

    @property
    def rank_col(self) -> str:
        return f"{self.name}_composite_rank"


COMPOSITES: tuple[CompositeSpec, ...] = (
    CompositeSpec(name="hpi",   features=HPI_MAX_FEATURES),
    CompositeSpec(name="zori",  features=ZORI_MAX_FEATURES),
    CompositeSpec(name="joint", features=JOINT_FEATURES),
)

TIERS = ("tier1_demand", "tier4_momentum")


# ── Back-compat exports ──────────────────────────────────────────────────
# Older code (evaluate_ablation, run_backtest) expects a single FEATURES
# tuple. Point it at the union so ablation covers every candidate feature.
FEATURES: tuple[FeatureSpec, ...] = _ALL_FEATURES


WINSORIZE_LOWER_Q = 0.01
WINSORIZE_UPPER_Q = 0.99


def _zscore(s: pd.Series) -> pd.Series:
    """Population z-score with 1st/99th-percentile winsorization applied first.

    Winsorization prevents extreme outliers (tiny counties with wild YoY
    swings, COVID-era one-offs, data-pipeline glitches) from distorting the
    cross-sectional mean/std so much that legitimate-range counties get
    squished to near-zero z-scores. Clipping the tails preserves relative
    ordering while restoring discriminative power for the middle 98%."""
    if s.dropna().empty:
        return pd.Series(np.nan, index=s.index)
    p_lo, p_hi = s.quantile([WINSORIZE_LOWER_Q, WINSORIZE_UPPER_Q])
    if pd.notna(p_lo) and pd.notna(p_hi):
        s = s.clip(lower=p_lo, upper=p_hi)
    mu = s.mean(skipna=True)
    sigma = s.std(ddof=0, skipna=True)
    if sigma == 0 or pd.isna(sigma):
        return pd.Series(0.0, index=s.index)
    return (s - mu) / sigma


def _tier_score(z_cols: list[str], out: pd.DataFrame) -> pd.Series:
    """Mean of z-score columns (already sign-flipped). NaN when empty."""
    if not z_cols:
        return pd.Series(np.nan, index=out.index)
    return out[z_cols].mean(axis=1)


def score_period(df: pd.DataFrame) -> pd.DataFrame:
    """Score a single period's cross-section — computes all 3 composites.

    Output columns added:
        z_<feature>                         (one per unique feature across composites)
        {composite}_score_{tier}            (per-composite tier score)
        {composite}_composite_score         (final score per composite)
        {composite}_composite_rank          (rank per composite, 1=best)
        composite_score                     (alias for joint_composite_score)
        composite_rank                      (alias for joint_composite_rank)
    """
    out = df.copy()

    # Z-score every feature ONCE (dedupe across composites via master registry).
    for spec in _ALL_FEATURES:
        if spec.column not in out.columns:
            continue
        raw = out[spec.column]
        imputed = raw.fillna(raw.median(skipna=True))
        out[f"z_{spec.column}"] = spec.sign * _zscore(imputed)

    disq_mask = None
    if "any_disqualifier" in out.columns:
        disq_mask = out["any_disqualifier"] == True  # noqa: E712

    # Per-composite: compute tier scores + composite score + rank.
    for comp in COMPOSITES:
        tier_scores: list[str] = []
        for tier in TIERS:
            z_cols = [
                f"z_{s.column}" for s in comp.features
                if s.tier == tier and f"z_{s.column}" in out.columns
            ]
            tier_score_col = f"{comp.name}_score_{tier}"
            out[tier_score_col] = _tier_score(z_cols, out)
            tier_scores.append(tier_score_col)
        # Composite = mean of tier scores (equal-weighted tier structure).
        # NaN-safe mean via .mean(axis=1) drops NaN tiers automatically.
        out[comp.score_col] = out[tier_scores].mean(axis=1)
        if disq_mask is not None:
            out.loc[disq_mask, comp.score_col] = np.nan
        out[comp.rank_col] = out[comp.score_col].rank(
            ascending=False, method="min", na_option="bottom"
        ).astype("Int64")

    # Back-compat aliases: composite_score / composite_rank = JOINT.
    out["composite_score"] = out["joint_composite_score"]
    out["composite_rank"] = out["joint_composite_rank"]

    # Back-compat tier score cols for older mart_backtest_scores schema.
    # (score_tier1_demand, score_tier4_momentum) point at JOINT's per-tier
    # scores. New model consumers should read {composite}_score_{tier}.
    for tier in TIERS:
        out[f"score_{tier}"] = out[f"joint_score_{tier}"]

    return out


def score_all_periods(df: pd.DataFrame) -> pd.DataFrame:
    """Apply score_period to every period_end_date in df.

    Explicit loop (not groupby.apply) because pandas 2.2+ excludes group
    key from group DataFrame by default, stripping `period_end_date`.
    """
    return pd.concat(
        [score_period(group) for _period, group in df.groupby("period_end_date")],
        ignore_index=False,
    )
