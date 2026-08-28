.PHONY: install ingest-fhfa ingest-all query-fhfa test lint clean

# Setup — install deps into .venv/. Requires `uv` (https://docs.astral.sh/uv/).
install:
	uv sync

# Phase 1 ingest — one source at a time. Each is idempotent per as_of_date;
# safe to re-run within the same day.
ingest-fhfa:
	uv run python -m ingest.fhfa_hpi

# All Phase 1 sources — add more targets as loaders land.
ingest-all: ingest-fhfa
	@echo "TODO: add zillow_zori, bls_qcew, census_pep, bps_permits, hud_usps_vacancy"

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
