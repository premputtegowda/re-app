-- Per-(experiment, target, regime) Spearman diagnostics. UI's backtest
-- performance page reads this. Also useful for the "does the framework
-- ship" decision — filter to experiment IN ('composite', 'baseline') and
-- regime = 'all' for the head-to-head.
select
    experiment,
    target,
    regime,
    spearman,
    n,
    p_value,
    scoring_run_ts
from {{ source('backtest', 'diagnostics') }}
