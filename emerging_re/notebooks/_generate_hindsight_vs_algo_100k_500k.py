"""Generate strategy_hindsight_vs_algo_100k_500k.ipynb — pop 100K-500K variant.

Bridges the small-metro (100K-300K) and mid-metro (300K-1M) tiers. Uses base-tier gates
(HHI 0.20 / 0.15) — tighter gates would kill much of the small-metro universe.
"""
from __future__ import annotations
import json, sys
from pathlib import Path

NB_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(NB_DIR))
from _generate_strategy_notebooks import CONFIG_CELL, DATA_LOAD_CELL, STRATEGIES, md, code, wrap
from _generate_hindsight_vs_algo_notebook import (
    TITLE, COMPARISON_CELL, SUMMARY_CELL,
    SINGLE_DEAL_MD, SINGLE_DEAL_CELL,
    PER_PICK_HINDSIGHT_MD, PER_PICK_HINDSIGHT_CELL,
    WITHIN_PICK_MD, WITHIN_PICK_CELL,
    TIEBREAKER_MD, TIEBREAKER_CELL,
    BORDA_MD, BORDA_CELL,
)

EV = STRATEGIES['emerging_value']

override_100k_500k = """
# ── EMERGING-VALUE overrides (POP 100K-500K bridge variant) ──────────────
POP_MIN            = 100_000
POP_MAX            = 500_000
HHI_MAX            = 0.20       # base-tier gate (kills undiversified small metros naturally)
TOP_N              = 10
MAX_PER_STATE      = 3
MAX_SECTOR_SHARE   = 0.25
MIN_CAP_SPREAD_PP  = 0.0
MAX_HHI_STRATEGY   = 0.15
"""

TITLE_100K_500K = TITLE.replace(
    'EMERGING-VALUE — Hindsight vs Algorithm',
    'EMERGING-VALUE 100K-500K — Hindsight vs Algorithm'
) + """

**This variant screens 100K-500K pop** — bridges the small-metro (100K-300K where weights matter)
and mid-metro (300K-1M where Borda ties weighted) tiers.

Uses base-tier gates (HHI 0.20 / 0.15) rather than the tighter small-metro calibration.
Rationale: the base gate naturally screens out single-employer small metros while keeping
diversified ones. If a 150K county is diversified enough to pass HHI ≤ 0.15, it likely
belongs in the universe.

What to look for:
- If Borda ties weighted → the weight-matters finding at 100K-300K was driven by the
  most-concentrated small metros; broader universe washes it out.
- If weighted still beats Borda → the small-metro information edge for cap-spread is
  real and doesn't require tight-HHI to appear.
"""

config_with_overrides = CONFIG_CELL + override_100k_500k + "\nSTRATEGY_NAME = 'EMERGING-VALUE-100K-500K'\n"

cells = [
    md(TITLE_100K_500K),
    md("## 1. Config"),
    code(config_with_overrides),
    md("## 2. Load universe + return metrics"),
    code(DATA_LOAD_CELL),
    md("## 3. Algorithm implementation (EMERGING-VALUE, same signals)"),
    code(EV['method_code']),
    md("## 4. Year-by-year: hindsight vs algorithm"),
    code(COMPARISON_CELL),
    md("## 5. Aggregate summary"),
    code(SUMMARY_CELL),
    md(SINGLE_DEAL_MD),
    code(SINGLE_DEAL_CELL),
    md(PER_PICK_HINDSIGHT_MD),
    code(PER_PICK_HINDSIGHT_CELL),
    md(WITHIN_PICK_MD),
    code(WITHIN_PICK_CELL),
    md(TIEBREAKER_MD),
    code(TIEBREAKER_CELL),
    md(BORDA_MD),
    code(BORDA_CELL),
]

nb = wrap(cells)
out = NB_DIR / 'strategy_hindsight_vs_algo_100k_500k.ipynb'
out.write_text(json.dumps(nb, indent=1))
print(f'wrote {out.name}   ({len(cells)} cells)')
