"""Diagnostic computations — Spearman rank correlation vs targets,
regime splits, per-feature ablation."""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd
from scipy import stats

from ._scoring import FEATURES, TIERS, score_all_periods


# Regime splits per DECISIONS.md §7. Pre/post-2022 was the framework's
# original ask; adding a middle regime for COVID isolation.
REGIMES = {
    "all":       lambda dt: pd.Series(True, index=dt.index),
    "2015-2019": lambda dt: (dt >= "2015-01-01") & (dt <= "2019-12-31"),
    "2020-2022": lambda dt: (dt >= "2020-01-01") & (dt <= "2022-12-31"),
    "2023-2025": lambda dt: (dt >= "2023-01-01") & (dt <= "2025-12-31"),
}

TARGETS = ("target_hpi_24mo_demeaned", "target_zori_24mo_demeaned")

# Baseline signals — what the framework must beat. Pre-registered per
# DECISIONS.md ("baseline = trailing-12mo price growth"). Momentum in
# BOTH HPI and ZORI to cover both targets fairly.
BASELINE_FEATURES = {
    "target_hpi_24mo_demeaned":  ("hpi_yoy",  "trailing 12mo HPI"),
    "target_zori_24mo_demeaned": ("zori_yoy", "trailing 12mo ZORI"),
}


@dataclass(frozen=True)
class SpearmanResult:
    experiment: str          # "composite" | "baseline" | "ablation:<feat>"
    target: str
    regime: str
    spearman: float | None   # None if sample too small
    n: int
    p_value: float | None


def _spearman(df: pd.DataFrame, feature_col: str, target_col: str) -> tuple[float | None, int, float | None]:
    """Rank correlation between feature and target. NaN pairs excluded.
    Returns (rho, n, p) or (None, n, None) if n < 30."""
    valid = df[[feature_col, target_col]].dropna()
    n = len(valid)
    if n < 30:
        return None, n, None
    rho, p = stats.spearmanr(valid[feature_col], valid[target_col])
    return float(rho), n, float(p)


def evaluate(
    scored: pd.DataFrame,
    experiment_label: str,
    score_col: str = "composite_score",
) -> list[SpearmanResult]:
    """Compute Spearman for (score_col vs each target) across all regimes.

    `scored` must have `period_end_date` + `score_col` + all targets.
    """
    results: list[SpearmanResult] = []
    for target in TARGETS:
        if target not in scored.columns:
            continue
        for regime_name, mask_fn in REGIMES.items():
            mask = mask_fn(scored["period_end_date"])
            subset = scored.loc[mask]
            rho, n, p = _spearman(subset, score_col, target)
            results.append(SpearmanResult(
                experiment=experiment_label, target=target, regime=regime_name,
                spearman=rho, n=n, p_value=p,
            ))
    return results


def evaluate_baseline(scored: pd.DataFrame) -> list[SpearmanResult]:
    """Evaluate the baseline momentum feature against its matched target."""
    results: list[SpearmanResult] = []
    for target, (baseline_col, _label) in BASELINE_FEATURES.items():
        if baseline_col not in scored.columns or target not in scored.columns:
            continue
        for regime_name, mask_fn in REGIMES.items():
            mask = mask_fn(scored["period_end_date"])
            subset = scored.loc[mask]
            rho, n, p = _spearman(subset, baseline_col, target)
            results.append(SpearmanResult(
                experiment="baseline", target=target, regime=regime_name,
                spearman=rho, n=n, p_value=p,
            ))
    return results


def evaluate_ablation(scored_full: pd.DataFrame, features_df: pd.DataFrame) -> list[SpearmanResult]:
    """Leave-one-out ablation. For each feature, rebuild the composite
    WITHOUT that feature and measure the Spearman drop. Uses the
    already-scored full model as the reference — this function only
    re-scores with reduced feature sets."""
    from ._scoring import FEATURES as _FEATURES, score_period, _zscore

    results: list[SpearmanResult] = []
    for held_out in _FEATURES:
        reduced_features = tuple(s for s in _FEATURES if s is not held_out)
        # Ad-hoc re-score with reduced features.
        # (Avoids a monkey-patch dance by inlining a minimal version.)
        def _score_period_reduced(df: pd.DataFrame, feats=reduced_features) -> pd.DataFrame:
            out = df.copy()
            for spec in feats:
                if spec.column not in out.columns:
                    continue
                raw = out[spec.column]
                imputed = raw.fillna(raw.median(skipna=True))
                out[f"z_{spec.column}"] = spec.sign * _zscore(imputed)
            for tier in TIERS:
                tier_zcols = [
                    f"z_{s.column}" for s in feats
                    if s.tier == tier and f"z_{s.column}" in out.columns
                ]
                if tier_zcols:
                    out[f"score_{tier}"] = out[tier_zcols].mean(axis=1)
                else:
                    # Tier has zero features after ablation → skip it in composite.
                    out[f"score_{tier}"] = np.nan
            tier_cols_valid = [f"score_{t}" for t in TIERS if not out[f"score_{t}"].isna().all()]
            out["ablated_score"] = out[tier_cols_valid].mean(axis=1) if tier_cols_valid else np.nan
            if "any_disqualifier" in out.columns:
                disq_mask = out["any_disqualifier"] == True  # noqa: E712
                out.loc[disq_mask, "ablated_score"] = np.nan
            return out

        rescored = pd.concat(
            [_score_period_reduced(group) for _p, group in features_df.groupby("period_end_date")],
            ignore_index=False,
        )
        exp_label = f"ablation:drop_{held_out.column}"
        # Only report the "all" regime for ablation to keep the report tight.
        for target in TARGETS:
            rho, n, p = _spearman(rescored, "ablated_score", target)
            results.append(SpearmanResult(
                experiment=exp_label, target=target, regime="all",
                spearman=rho, n=n, p_value=p,
            ))
    return results
