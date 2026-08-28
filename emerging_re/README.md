# emerging_re

County-level real-estate market screener. Ranks ~500-600 US counties by whether
they are "emerging" — demand arriving faster than supply can respond, and
prices haven't repriced yet.

**Read [`DECISIONS.md`](DECISIONS.md) first.** The design choices that determine
how everything else is built (bitemporal schema, dual-target backtest,
inclusion rules, success thresholds) live there.

## Quickstart

Requires Python 3.11+. Recommended: [uv](https://docs.astral.sh/uv/) for dep
management.

```bash
cd emerging_re
uv sync                          # install deps to .venv/
uv run python -m ingest.fhfa_hpi # download + snapshot + normalize FHFA HPI
```

First-run output:

- `data/raw/fhfa_hpi/{YYYY-MM-DD}/*.txt.gz` — raw snapshot (immutable)
- `data/curated/fhfa_hpi/as_of_date={YYYY-MM-DD}/*.parquet` — normalized rows
- `data/quarantine/fhfa_hpi/{YYYY-MM-DD}/*.csv` — rows that failed validation

Query the curated table with DuckDB:

```bash
uv run python -c "
import duckdb
c = duckdb.connect()
r = c.execute('''
  SELECT fips, period_end_date, hpi
  FROM read_parquet(\"data/curated/fhfa_hpi/**/*.parquet\", hive_partitioning=1)
  WHERE fips = \"39049\"  -- Franklin County, OH
  ORDER BY period_end_date DESC
  LIMIT 5
''').fetchall()
for row in r: print(row)
"
```

## Repository layout

```
emerging_re/
├── DECISIONS.md              ← foundational design decisions (READ FIRST)
├── README.md
├── pyproject.toml
├── data/                     ← immutable snapshots + curated Parquet
│   ├── raw/                    (per-source, per-as_of_date CSVs)
│   ├── curated/                (per-model, Parquet partitioned by as_of_date)
│   ├── quarantine/             (validation failures, never silently dropped)
│   └── crosswalks/             (FIPS canonical + historical crosswalks)
├── ingest/                   ← one Python loader per source
│   ├── _common.py              (shared HTTP + snapshot + bitemporal helpers)
│   ├── fhfa_hpi.py             (Phase 1)
│   └── ... (zillow_zori, bls_qcew, census_pep, bps_permits, hud_usps_vacancy)
├── crosswalks/               ← FIPS normalization + universe builder
│   ├── normalize_fips.py
│   └── build_universe.py       (Phase 2)
├── dbt/                      ← Phase 2 (feature models)
├── backtest/                 ← Phase 3
└── serve/                    ← Phase 4 (API + UI)
```

## Design principles (see DECISIONS.md for full rationale)

1. **Bitemporal storage.** Every table keyed on `(fips, period_end_date, as_of_date)`.
   Never overwrite; always append. This is the only defense against look-ahead
   bias when backtesting against sources that restate history (Zillow, BLS).

2. **Immutable raw snapshots.** Every scheduled ingest saves the raw file to
   `data/raw/{source}/{as_of_date}/`. Zillow restates its full history every
   month — past vintages are gone forever if we don't snapshot them.

3. **Never silently drop rows.** Rows that fail FIPS normalization or schema
   validation go to `data/quarantine/`, not `/dev/null`. Manual review only.

4. **2020 FIPS canonical.** All data stored keyed on 2020 Census FIPS codes.
   Historical FIPS (pre-2015 Alaska, pre-2001 Colorado, etc.) remapped via
   the NBER crosswalk during ingest.

5. **Linear composite scoring.** The eventual ranking is an equal-weighted
   sum of tier metrics. No ML in the scorer (small N, interpretability
   required, feature-eng > model-choice for this problem). ML used only for
   Phase 5 catalyst extraction and as a Phase 3 diagnostic.

## Phase status

- [x] Phase 0 — DECISIONS.md
- [ ] Phase 1 — Ingestion (in progress: FHFA HPI landed)
- [ ] Phase 2 — Features + target (dbt models)
- [ ] Phase 3 — Backtest (pins absolute thresholds, evaluates composite)
- [ ] Phase 4 — Serving (FastAPI + UI)
- [ ] Phase 5 — Catalyst tracker (LLM extraction)
- [ ] Phase 6 — Automation (GitHub Actions)
