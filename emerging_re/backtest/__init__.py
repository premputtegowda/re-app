"""Emerging-RE backtest package.

Reads mart_county_features from the dbt-built DuckDB warehouse, computes
composite scores per period, and evaluates them against forward-return
targets (Spearman rank correlation vs a trailing-momentum baseline).

Run: `uv run python -m backtest.run_backtest`
"""
