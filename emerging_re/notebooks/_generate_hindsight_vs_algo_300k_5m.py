"""Generate strategy_hindsight_vs_algo_300k_5m.ipynb — same as base notebook but pop 300K-5M.

Purpose: test whether the framework's findings (Borda ties weighted, mean-reversion tiebreaker
doesn't work, gates carry the alpha) hold when the universe extends to mid/large metros.

Reuses all cells from _generate_hindsight_vs_algo_notebook.py but overrides POP_MAX.
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

# Override the pop range: 300K-5M instead of 300K-1M
override_300k_5m = """
# ── EMERGING-VALUE overrides (POP 300K-5M variant) ────────────────────────
POP_MIN            = 300_000    # unchanged
POP_MAX            = 5_000_000  # widened from 1M → 5M
HHI_MAX            = 0.20       # unchanged
TOP_N              = 10
MAX_PER_STATE      = 3
MAX_SECTOR_SHARE   = 0.25
MIN_CAP_SPREAD_PP  = 0.0        # NOTE: signal weakens near gateway pops (2M+)
MAX_HHI_STRATEGY   = 0.15
"""

TITLE_300K_5M = TITLE.replace(
    'EMERGING-VALUE — Hindsight vs Algorithm',
    'EMERGING-VALUE 300K-5M — Hindsight vs Algorithm'
) + """

**This variant extends the universe to pop 300K-5M.** All other gates are unchanged.

Caveats to keep in mind:
- `cap_spread_to_gateway_pp` (the +2.0 heavyweight in the weighted score) becomes less meaningful
  as pop approaches gateway-metro size (2M+). Institutional-absence thesis dissolves near gateways.
- If Borda still ties or beats the weighted score at this wider universe, the finding generalizes.
- Compare vs the base 300K-1M notebook to see whether the same markets bubble up.
"""

config_with_overrides = CONFIG_CELL + override_300k_5m + "\nSTRATEGY_NAME = 'EMERGING-VALUE-300K-5M'\n"

cells = [
    md(TITLE_300K_5M),
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
out = NB_DIR / 'strategy_hindsight_vs_algo_300k_5m.ipynb'
out.write_text(json.dumps(nb, indent=1))
print(f'wrote {out.name}   ({len(cells)} cells)')
