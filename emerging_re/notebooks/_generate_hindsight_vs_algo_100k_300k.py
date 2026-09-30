"""Generate strategy_hindsight_vs_algo_100k_300k.ipynb — small-metro variant (pop 100K-300K).

Uses tighter HHI gates (matches existing strategy_emerging_value_small notebook calibration):
  - HHI_MAX = 0.15 (universe, tighter than 300K-1M's 0.20)
  - MAX_HHI_STRATEGY = 0.12 (strategy gate, tighter than 300K-1M's 0.15)

Rationale: small metros carry higher single-employer risk, so demand more diversification.
This will yield a much smaller qualified pool per year.
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

override_100k_300k = """
# ── EMERGING-VALUE overrides (POP 100K-300K small-metro variant) ─────────
POP_MIN            = 100_000    # small metros (secondary markets)
POP_MAX            = 300_000    # below the mid-metro band
HHI_MAX            = 0.15       # tighter than base (0.20) — small-metro single-employer risk
TOP_N              = 10
MAX_PER_STATE      = 3
MAX_SECTOR_SHARE   = 0.25
MIN_CAP_SPREAD_PP  = 0.0        # cap spread still meaningful — far from gateway pops
MAX_HHI_STRATEGY   = 0.12       # tighter than base (0.15)
"""

TITLE_100K_300K = TITLE.replace(
    'EMERGING-VALUE — Hindsight vs Algorithm',
    'EMERGING-VALUE 100K-300K — Hindsight vs Algorithm'
) + """

**This variant screens small metros (pop 100K-300K).** Gate calibration is tightened for HHI:

- `HHI_MAX = 0.15` (was 0.20) — universe filter, tighter
- `MAX_HHI_STRATEGY = 0.12` (was 0.15) — strategy gate, tighter

Rationale: small metros carry higher single-employer risk (one plant closes → market collapses).
So we demand more employment diversification than we would in mid-size metros.

Expected effects vs the 300K-1M base:
- Qualified pool will be much smaller per year (~10-30 vs 16-66)
- Cap rates will likely be higher (less institutional interest)
- `cap_spread_to_gateway_pp` still works cleanly here (far from gateway pops)
- If Borda still ties weighted, the finding fully generalizes across all three pop tiers

Compare to the base 300K-1M and 300K-5M notebooks to see whether the same top markets emerge.
"""

config_with_overrides = CONFIG_CELL + override_100k_300k + "\nSTRATEGY_NAME = 'EMERGING-VALUE-100K-300K'\n"

cells = [
    md(TITLE_100K_300K),
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
out = NB_DIR / 'strategy_hindsight_vs_algo_100k_300k.ipynb'
out.write_text(json.dumps(nb, indent=1))
print(f'wrote {out.name}   ({len(cells)} cells)')
