.PHONY: install ingest-fhfa ingest-zori ingest-pep ingest-pep-backfill ingest-bps ingest-all query-fhfa test lint clean

# Setup — install deps into .venv/. Requires `uv` (https://docs.astral.sh/uv/).
install:
	uv sync

# Phase 1 ingest — one source at a time. Each is idempotent per as_of_date;
# safe to re-run within the same day.
ingest-fhfa:
	uv run python -m ingest.fhfa_hpi

ingest-zori:
	uv run python -m ingest.zillow_zori

ingest-pep:
	uv run python -m ingest.census_pep

# One-time backfill — loads the V2019 PEP vintage (2010-2019) under its
# actual release-date as_of (2020-03-26) so the bitemporal schema reflects
# when this data was publicly available. Combined with `ingest-pep` this
# gives migration history from 2010 to the latest vintage year.
ingest-pep-backfill:
	uv run python -m ingest.census_pep --vintage 2019

# BPS = building permits. Default loads 2000 through current year — one
# Dec YTD file per year plus latest partial for current year. Coverage
# is thin (~750 counties) before 2022, ~3000 counties from 2022 on;
# see DECISIONS.md §3 footnote.
ingest-bps:
	uv run python -m ingest.census_bps

# All Phase 1 sources — add more targets as loaders land.
ingest-all: ingest-fhfa ingest-zori ingest-pep ingest-bps
	@echo "TODO: add bls_qcew, hud_usps_vacancy"

# Sanity query — dumps last 5 rows for Franklin County, OH from curated FHFA.
query-fhfa:
	uv run python -c "\
import duckdb, glob; \
files = sorted(glob.glob('data/curated/fhfa_hpi/**/*.parquet', recursive=True)); \
print('Parquet files:', files); \
r = duckdb.connect().execute(\"\"\"\
  SELECT fips, period_end_date, hpi, annual_change_pct, state, county_name \
  FROM read_parquet('data/curated/fhfa_hpi/**/*.parquet', hive_partitioning=1) \
  WHERE fips = '39049' \
  ORDER BY period_end_date DESC LIMIT 5\
\"\"\").fetchall(); \
[print(row) for row in r]"

test:
	uv run pytest

lint:
	uv run ruff check .

# Clean curated + quarantine (keeps raw snapshots — those are immutable history).
clean:
	rm -rf data/curated data/quarantine
