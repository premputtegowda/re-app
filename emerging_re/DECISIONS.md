# DECISIONS.md — Emerging-RE Module (Phase 0)

**Version:** 0.4
**Last updated:** 2026-08-28
**Status:** Draft — awaiting sign-off before Phase 1 (ingestion) begins

**Changelog:**
- 0.4 — Dual target for backtest: composite is evaluated against BOTH forward
  HPI (appreciation) and forward ZORI (rent growth). Ship criterion is "pass
  at least one target, label the county's ranking accordingly." Captures the
  fact that appreciation markets and rental markets are both actionable for a
  rental investor — different regimes, both valuable. Also adds ZORI coverage
  to inclusion rule (Section 5) — reduces universe from ~800 to ~500-600.
- 0.3 — Added Section 11 on machine learning scope: linear equal-weight
  composite is the scorer; ML restricted to catalyst NLP (Phase 5) and Phase 3
  diagnostic (detect non-linear signal, refactor features rather than switch
  scorer).
- 0.2 — Section 7 rewritten: success thresholds are now framed as margins over
  a computed baseline (trailing-12mo momentum) with absolute numbers pinned in
  Phase 3 before composite scoring. Original absolute thresholds (Spearman ≥
  0.20, top-decile ≥ 2pp, regime ≥ 0.15) were vibes-based, not derived from
  the dataset. New shape commits to discipline without false precision.
- 0.1 — Initial draft.

## Purpose of this document

Fix the decisions that would be expensive to unwind later. Everything downstream
(loaders, features, backtests, serving) should be buildable from this document
without asking follow-up questions. If you find yourself needing a decision
that's not here, either amend this doc or add it to Open Questions.

## Governing principle (context, not decision)

An emerging market has three properties simultaneously: **demand arriving**,
**supply constrained**, and **prices haven't repriced yet**. All three matter.
Every metric we ingest answers one of those three questions. Everything else is
noise.

---

## 1. Bitemporal schema — every table is (fips, period_end_date, as_of_date)

**Decision:** All source tables carry three key columns:

- `fips` — 5-character 2020 Census FIPS county code
- `period_end_date` — the last day of the period the value describes
  (e.g. `2024-03-31` for Q1 2024 data)
- `as_of_date` — the date we downloaded the file. NOT the source's publish date;
  the date OUR ingest ran and observed this value.

Primary key = `(fips, period_end_date, as_of_date)`. Never overwrite. Always
append.

**Query patterns:**

- **Latest view** (dashboards, current rankings):
  ```sql
  WHERE as_of_date = (SELECT MAX(as_of_date) FROM t)
  ```
- **"Score this county as of X"** (backtests, look-ahead-safe):
  ```sql
  WHERE as_of_date <= 'X'
  QUALIFY ROW_NUMBER() OVER (PARTITION BY fips, period_end_date ORDER BY as_of_date DESC) = 1
  ```

**Why:** Sources restate. BLS QCEW revises ~90 days after initial publish;
Zillow ZHVI restates its ENTIRE history every month. Back-testing against
today's file uses information that wasn't available at score time — the
look-ahead bias that would silently inflate every result. Bitemporal is the
only defense, and retrofitting it later means re-ingesting everything.

**Note on `as_of_date` semantics:** It's the observation date, not the publish
date, because we can control our own ingest schedule but not the source's
publish latency. If a source publishes Q1 data on May 15 and our ingest runs
May 20, `as_of_date = 2024-05-20`. `period_end_date = 2024-03-31`.

---

## 2. Storage — Parquet on local disk, DuckDB for compute

**Decision:** All raw and curated data lives in Parquet files under
`emerging_re/data/`. DuckDB is the SQL engine. No Postgres, no dbt-postgres, no
warehouse.

**Layout:**

```
emerging_re/data/
├── raw/{source}/{as_of_date}/*.csv.gz
│     ← immutable snapshots. as_of_date = ingest date.
│     ← never delete, never mutate.
├── curated/{model}/as_of_date={date}/*.parquet
│     ← dbt-materialized features, partitioned by as_of_date.
│     ← rebuildable from raw at any time.
├── quarantine/{source}/{as_of_date}/*.csv.gz
│     ← rows that failed FIPS normalization or schema validation.
│     ← manual review, never silently dropped.
└── crosswalks/
      ├── fips_2020_canonical.csv
      ├── fips_historical_to_2020.csv  (NBER crosswalk, weighted)
      └── county_metadata.csv          (name, state, 2020 pop)
```

**Backup:** Nightly `rclone sync` to S3 (or the user's cloud of choice) once
Phase 1 lands. Not day-1 blocker.

**Why:** Snapshots become immutable file copies (free). Restatements are new
partitions (natural fit). Zero infrastructure — no server, no schema
migrations, no ORM. If the module ever needs to be productized, DuckDB reads
from S3 in production and this shape ports directly.

**Rejected alternatives:**

- **Postgres** — good SQL, but rows are mutable and we spend the whole design
  fighting the append-only requirement. Also adds infra (schema migrations,
  connection pooling, backups) for near-zero benefit at this scale.
- **BigQuery/Snowflake** — overkill, monthly costs for a ~50GB dataset make no
  sense.
- **CSV-only** — no columnar compression, slow scans, no schema enforcement.

---

## 3. Source lag + snapshot cadence table

**Decision:** Every source has an explicit lag (informs backtest windows) and
snapshot cadence (informs how often we re-ingest). Table is the source of truth.

| Source | Table code | Cadence | Publish lag | Restates? | Snapshot every |
|---|---|---|---|---|---|
| FHFA HPI (county) | `fhfa_hpi` | Quarterly | ~3 mo | Minor revisions | Quarter |
| Census BPS (permits) | `census_bps` | Monthly | ~2 mo | Occasionally | Month* |
| BLS QCEW (employment by sector) | `bls_qcew` | Quarterly | ~5 mo | **Yes, ~90 days** | Quarter |
| Census PEP (population/migration) | `census_pep` | Annual | ~9 mo | Minor | Year |
| Zillow ZHVI (home value index) | `zillow_zhvi` | Monthly | ~1 mo | **Full history, monthly** | Month |
| Zillow ZORI (rent index) | `zillow_zori` | Monthly | ~1 mo | **Full history, monthly** | Month |
| HUD USPS vacancy | `hud_usps_vacancy` | Quarterly | ~3-4 mo | Minor | Quarter |

**Rule:** Snapshot on every scheduled run regardless of whether we think the
source restated. Marginal cost of an extra CSV is ~50MB; marginal cost of
losing a vintage is unrecoverable. Total storage: ~7 sources × 100MB avg ×
12 monthly snapshots = ~8GB/year. Trivial.

**\* Census BPS coverage cliff (discovered 2026-08-28):** Pre-2022 county
files include only counties with at least one reporting permit-issuing
jurisdiction (~750 counties total, ~45% of pop≥50k universe). Starting the
2022 vintage, Census publishes all ~3,000 counties (with imputation for
non-reporters). Impact on target universe:

| Population rank | Pre-2022 BPS coverage |
|---|---|
| Top 100 | 83% |
| Top 300 | 67% |
| Top 500 | 47% |
| 500-750 | 35% |

**Downstream implication:** The historical backtest can compute BPS-based
features (permits per capita, 3-yr rolling permits) for the ~half of the
target universe with continuous coverage. Options at Phase 3: (a) restrict
backtest to BPS-covered counties, or (b) run with-BPS vs no-BPS feature
sets and measure marginal Spearman lift to decide if BPS is worth the
sample-size hit.

**Look-ahead rule (backtests only):** When scoring a county at `t`, only use
rows where `as_of_date <= t - lag_source` where `lag_source` comes from this
table. E.g. scoring Jan 2020 against QCEW means using data with
`period_end_date <= 2019-06-30` (i.e. Q2 2019 latest, since Q3 2019 wasn't
publishable until Feb 2020).

---

## 4. County pinning — 2020 FIPS, historical crosswalked

**Decision:** All data is stored keyed on 2020 Census FIPS codes. Historical
data (pre-2015 Alaska, pre-2001 Colorado, various VA independent-city merges)
is remapped via the NBER county crosswalk. Anything that can't map cleanly
lands in `quarantine/`, never silently dropped or coerced.

**Normalization pipeline (runs during ingest):**

```
normalize_fips(input_fips, input_period_end_date):
  1. If input_fips in fips_2020_canonical → pass through
  2. Else, look up in fips_historical_to_2020
     - If unique mapping (rename only, weight=1.0) → remap
     - If split/merge (multiple targets with weights) → apply pop-weighted
       redistribution BUT flag row for review; splits are lossy
  3. Else → write to quarantine with reason "unknown FIPS after {date}"
```

**Known cases the crosswalk must handle:**

- Alaska: Wade Hampton (02270) → Kusilvak (02158), 2015
- Alaska: Petersburg Census Area (02195) carved out, 2013
- Colorado: Broomfield (08014) created from 4 counties, 2001
- Virginia: Bedford City (51515) reverted to Bedford County (51019), 2013
- ~30 other historical splits/renames tracked in NBER file

**VA independent cities:** Treated as their own FIPS in Census data. Kept
separate rather than folded into surrounding counties. Rationale: they report
their own permits, employment, and population, so folding them corrupts
per-capita denominators. Ranking table shows them as "Fairfax city, VA"
alongside "Fairfax County, VA".

---

## 5. Inclusion rule — pop ≥50k with 10yr continuous coverage on BOTH targets

**Decision:** A county enters the universe if:

1. 2020 population ≥50,000 (from Census `census_pep`)
2. Has non-null values in all Phase 1 sources for `period_end_date >= 2015-01-01`
   (at least 10 years of coverage → 40 quarterly vintages for backtests)
3. Has non-null **Zillow ZORI (rent index) values from 2018-01-01** — needed
   so rent-target backtest has enough history (ZORI has less coverage than
   FHFA HPI, this is the constraint that binds)
4. Isn't a US territory (excluded from FHFA HPI coverage anyway)

Result: ~500-600 counties (down from ~800 pre-ZORI-requirement).
Written to `data/curated/universe.parquet`.

Counties below 50k pop OR without ZORI coverage are ingested (for potential
future use) but excluded from ranking, backtest scoring, and the UI.

**Why 50k?** Below that, single-employer concentration is the norm, not the
exception (which would trigger our disqualifier), and monthly BPS permit data
gets noisy (single-digit permits are the median).

**Why 10yr coverage on HPI + 8yr on ZORI?** Phase 3 backtest scores at annual
vintages from 2015 onward for HPI target and 2018 onward for ZORI target.
Different history depths per target but both give enough vintages for
non-degenerate Spearman calculation.

**Alternative considered:** Two universes ("full universe" for HPI target,
"rent-covered subset" for ZORI target). Rejected because it complicates the
composite scoring — the same county would get different ranks depending on
which universe it's in. Simpler to intersect and use one universe for both.

---

## 6. License posture — Zillow ZORI is now central, productization risk elevated

**Decision matrix:**

| Source | License | OK for personal/internal use? | OK for productization? |
|---|---|---|---|
| FHFA HPI | Public domain (US Gov) | ✅ | ✅ |
| Census (PEP, BPS) | Public domain (US Gov) | ✅ | ✅ |
| BLS QCEW | Public domain (US Gov) | ✅ | ✅ |
| HUD USPS vacancy | Free w/ HUD account, ToS applies | ✅ | ⚠️ Check ToS |
| Zillow ZHVI | "Personal, non-commercial" per Zillow Research Terms | ✅ | ❌ Must replace |
| **Zillow ZORI** (rent index) | "Personal, non-commercial" per Zillow Research Terms | ✅ | ❌ Must replace |

**Decision:** Build phase 1 with Zillow. If/when productization is planned,
Zillow gets replaced with a licensed source.

**Elevated productization risk:** ZORI is now a co-target for the backtest
(Section 7), not just a supplementary input. If this module ever gets
productized, we can't just "drop Zillow" — we'd need a licensed rent index
of comparable coverage. Realistic options:

- **Apartments.com research** — proprietary, requires licensing negotiation
- **CoStar / STR** — enterprise pricing (~$$$$$)
- **CoreLogic Multifamily** — enterprise pricing (~$$$$)
- **Roll our own from public data** — HUD FMR (Fair Market Rent) as a proxy,
  but it's designed for voucher-program administration, not investment
  signal, and lags market rents by 12-18 months. Weak substitute.

Practical implication: this module can never be a paid product without
resolving the ZORI dependency. Fine for personal use, fine for a free/
non-commercial tool. Flag in every doc that describes future plans.

**License notice** to include in the eventual UI: "Home value and rent data
sourced from Zillow Research. For personal non-commercial use only."

---

## 7. Pre-registered success thresholds — dual target, relative to baseline

**Decision — commit to the SHAPE of the tests before Phase 3, pin ABSOLUTE
thresholds after computing baselines but BEFORE scoring the composite:**

The composite is evaluated against **two forward targets** since rental
investors care about both appreciation (equity growth on exit) and rent
growth (cash flow while holding):

- **Target A — forward 24mo FHFA HPI change**, demeaned vs national median
- **Target B — forward 24mo Zillow ZORI change**, demeaned vs national median

Each target has its own naive momentum baseline (trailing-12mo growth of the
same series) that the composite must beat by a margin.

### The three thresholds — applied per target

For EACH of Target A (HPI) and Target B (ZORI):

1. **Composite Spearman > baseline Spearman + 0.05.**
   Beat trailing-12mo momentum of the same series by ≥ 0.05 Spearman.
   Adding features to beat momentum by less than 0.05 is noise within
   Spearman's own sampling variance.

2. **Top-decile lift > baseline top-decile lift + 1pp annualized.**
   Top 80 counties by composite score must outperform the bottom 720 by
   ≥ 1pp/yr more than the top-80-by-momentum-baseline does.

3. **Regime stability: composite ≥ baseline − 0.03 in each half of the
   pre/post-2022 split.** Guards against composites that only work in one
   macro regime.

### Ship criterion — pass at least ONE target, label the county's rank

- **Pass Target A AND Target B** → "Strong emerging market" — composite is
  meaningfully predictive for both appreciation AND rent growth. Ship without
  label caveat.
- **Pass Target A only (HPI)** → "Appreciation market" signal. Ship with a
  label — top-of-list counties are expected to see price growth but the same
  ranking is NOT trustworthy for rent growth predictions.
- **Pass Target B only (ZORI)** → "Rental market" signal. Ship with a label —
  top-of-list counties are expected to see rent growth (cash flow) but the
  same ranking is NOT trustworthy for appreciation predictions.
- **Fail both** → don't ship the composite. Iterate features per the failure
  protocol below.

**Both a valid outcome for our user.** A rental investor who cares primarily
about cash flow gets real value from a "rental market" signal even if it
doesn't predict appreciation. A value-add flipper gets value from an
"appreciation market" signal even if rents are already at market. Different
regimes, both actionable. The UI must communicate which regime a county is
being ranked for.

### Sanity floors — don't ship even if we beat baseline on a target

Per target, if the baseline itself is < 0.05 Spearman (even momentum barely
works on our data for this target), composite hitting 0.10 isn't a proud
result. Absolute floor: composite Spearman ≥ **0.12** in the full sample for
that target, regardless of how it compares to baseline.

### Absolute thresholds get pinned in Phase 3, BEFORE composite scoring

Order of operations:

1. Phase 1-2: build ingestion + baseline model (trailing-12mo momentum, per
   target)
2. **Phase 3 step 1: score both baselines. For each of Target A and Target B,
   compute Spearman, top-decile lift, pre-2022 Spearman, post-2022 Spearman.
   Amend DECISIONS.md with those specific numbers (per target).**
3. Phase 3 step 2: score composite, compare against the numbers pinned in
   step 1 (per target). Pass/fail called against the frozen thresholds.

Anti-goalpost-moving discipline preserved: thresholds pinned before composite
results are visible.

### Failure protocol

If thresholds miss on BOTH targets:

- **We do NOT tune composite weights.** Weight-tuning against a backtest is
  p-hacking.
- **We revisit features.** Remove noisy ones, add new ones from the "additional
  data sources" list (HUD USPS long-term vacancy, Census BFS, FCC broadband,
  etc.). Re-backtest cold, once.
- **After two feature-revision cycles that both fail on both targets, we
  accept the thesis isn't supported by public data and stop.**

If thresholds miss on ONE target only, that's still a shippable outcome per
the ship criterion above — just labeled accordingly. Iteration is optional
(could try to improve the failing target with different features), not
required.

### Why NOT absolute numbers up-front

Section 7's numbers were originally vibes (Spearman ≥ 0.20, top-decile ≥ 2pp,
regime ≥ 0.15) — plausibly-sized for the domain, but not derived from either
(a) our specific dataset's null distribution, (b) actual baseline performance,
or (c) domain-expert input. Committing to made-up numbers is worse than not
committing:

- Too low → ship noise dressed up as signal
- Too high → never ship even with real signal
- Either way → bar unrelated to what our data can produce

Relative-to-baseline commits us to the discipline (beat the obvious thing
by a margin) without pretending we know the level.

### Options kept open for later revisit

Rejected for Phase 3 but may revisit if Option B (this) doesn't work:

- **Option A** — Two separate composites, one per target. Explored; deferred
  because features driving rent growth and price growth heavily overlap and
  a single composite should work for both if the fundamental thesis holds.
- **Option D** — Total return proxy target (cap rate × 24mo + terminal
  appreciation). Most economically meaningful for a rental investor, deferred
  to a possible Phase 4 UI enhancement (compute a total-return score for
  display) rather than the underlying backtest target.

---

## 8. Success is a SCREENING AID, not a predictor

**Decision (product framing):**

The UI presents the composite score alongside its component contributions AND
the backtest performance numbers. The intended user reads:

> "Score 87. Top 5% of counties. Historical top-decile Spearman 0.24 with
> forward 24-month HPI, ~60% of individual top-decile calls beat national median."

Not:

> "This county will appreciate."

Rationale: A screener that admits it's a screener gets used. A model that
claims to predict gets abandoned the first time it misses (which will
statistically happen ~40% of the time even with a genuinely good signal).

Implication for Phase 4 (UI): the backtest results page is not a hidden admin
tab, it's a primary navigation item.

---

## 9. Directory structure

```
emerging_re/
├── DECISIONS.md                     ← this file
├── README.md                        ← quickstart (Phase 1)
├── pyproject.toml                   ← Python deps (uv or poetry)
├── data/                            ← see section 2
├── ingest/                          ← Python loaders, one per source
│   ├── fhfa_hpi.py
│   ├── bps_permits.py
│   ├── bls_qcew.py
│   ├── census_pep.py
│   ├── zillow_zhvi.py
│   ├── zillow_zori.py
│   └── hud_usps_vacancy.py
├── crosswalks/                      ← FIPS normalization + universe builder
│   ├── normalize_fips.py
│   └── build_universe.py
├── dbt/                             ← feature models (Phase 2)
│   ├── models/
│   │   ├── staging/
│   │   ├── features/
│   │   └── scoring/
│   └── dbt_project.yml
├── backtest/                        ← Phase 3
│   ├── score_vintages.py
│   └── evaluate.py
└── serve/                           ← Phase 4
    ├── api/                         (FastAPI)
    └── ui/                          (Next.js route or standalone)
```

**Note on `serve/ui/`:** TBD whether it lives here as a standalone Next.js
sub-app or as a route under the main `app/(app)/emerging-re/`. Deferred to
Phase 4 because it depends on how much shared auth/nav we want.

---

## 10. Engineering choices — minimum toolchain

**Decision:**

- **Language:** Python 3.11+ for ingestion, features, backtest
- **SQL:** DuckDB (as noted in section 2)
- **Feature transforms:** dbt-duckdb (dbt with the DuckDB adapter)
- **Deps manager:** uv (fast, deterministic locking)
- **Testing:** pytest + dbt's built-in schema tests
- **Orchestration:** Phase 1-3 = manual (`make ingest`, `make backtest`).
  Phase 6 = GitHub Actions on cron.
- **Serving (Phase 4):** FastAPI backend, Next.js frontend (either standalone
  or integrated into reps-tracker)

**Rejected alternatives:**

- **Airflow / Prefect / Dagster** — overkill for a monthly ingest. GitHub
  Actions is enough until we hit real scheduling complexity.
- **Polars instead of DuckDB** — Polars is great for in-memory but we want SQL
  queryability + on-disk partitioning by `as_of_date`. DuckDB nails both.

---

## 11. Machine learning scope — restricted

**Decision:** The composite scorer is **linear equal-weighted** (per the
framework in the module plan). Machine learning is NOT used to produce the
ranking. Two exceptions where ML is used explicitly:

**Exception 1 — Catalyst extraction (Phase 5).** LLM-based structured
extraction from press releases, econ-dev feeds, and city council agendas.
Necessary because no other technique parses "Intel announces $20B fab
expansion in Ohio, 3000 jobs" into structured fields. Output goes through the
same bitemporal storage + strict-schema validation as other data sources.

**Exception 2 — Phase 3 diagnostic (non-linear signal check).** Once the
linear composite is built and backtested, fit a gradient-boosted tree
(xgboost) on the same features and same target as a diagnostic. Compare
Spearman:

- If **xgboost beats linear composite by ≥ 0.10 Spearman** → there's real
  non-linear signal (probably feature interactions we're missing). **Refactor
  features** — add explicit interaction terms to the linear composite. Do
  NOT switch to xgboost as the scorer.
- If **xgboost beats linear by < 0.10** → features are near-linear. ML buys
  nothing worth the interpretability cost.

The 0.10 threshold is roughly the same "meaningful improvement" bar as the
composite-vs-baseline margin in Section 7 — smaller gaps are within Spearman
sampling noise.

**Also allowed:** Feature-importance ranking from a tree ensemble as a
diagnostic for feature culling. If a feature has zero importance across
bootstrap samples, consider dropping from the composite.

### Why the composite scorer is linear (not ML)

1. **N is too small.** ~800 counties × ~10 annual scoring vintages = ~8,000
   rows. With ~20 features and needing a hold-out for validation, each ML
   experiment has variance that dwarfs any real signal we're trying to detect.
2. **Interpretability is required by the product.** Section 8 commits us to
   "county page must answer 'why is this ranked 14th' through visible
   component contributions." Linear composite is transparent; SHAP values on
   a tree model are hand-wavy and hard for users to trust.
3. **Regime risk is amplified.** ML overfits its training distribution.
   Trained on 2010-2019 low-rate world, an xgboost may be silently
   miscalibrated in 2022+ high-rate world. A linear composite fails
   predictably — you can inspect which components broke.
4. **Feature engineering >> model choice for this problem.** Getting the
   right ~20 features with proper look-ahead protection typically moves
   Spearman by 0.10-0.15. Switching linear → xgboost on the same features
   typically moves it by 0.02-0.05. The ML uplift is a rounding error
   compared to feature quality.
5. **Pre-registration is harder with ML.** More hyperparameters = more knobs
   to hack. Section 7's anti-p-hacking discipline is undermined if we're free
   to swap model architectures until one passes.

**Rejected alternative:** "Just fit xgboost / LightGBM / a small neural net —
they'll figure out the weights." They will fit something. That something
won't generalize past the training regime, won't be explainable, and will
be indistinguishable from a scored-by-vibes ranking to the user.

---

## Open questions (unresolved, need decision before Phase 4)

1. **Serving location** — dedicated Next.js sub-app in `emerging_re/serve/ui/`
   or a route inside the main reps-tracker (`app/(app)/emerging-re/`)?
   Depends on whether user wants shared auth/nav with the deal-analyzer.

2. **Alerting** — Phase 6 mentions "alerts on rank deltas". Delivery mechanism
   TBD: email, Slack, in-app notification, or all three?

3. **Historical FHFA data** — FHFA county HPI starts ~1975 for major metros
   but coverage varies. Do we cap the backtest history at 2000-01-01 for
   consistency across counties, or use each county's own maximum history?
   Recommend: 2015-01-01 uniformly for Phase 3 simplicity; expand later.

4. **Catalyst tracker source list** — Phase 5 mentions "state economic
   development feeds, Site Selection, city council agendas". Concrete list of
   URLs / RSS feeds / API endpoints TBD. Deferred to Phase 5.

5. **Weighted vs equal composite** — DECISIONS says equal-weight for Phase 3
   backtest, but composite might benefit from within-tier weighting (e.g.
   Tier 3 "rent > price growth" is called out as the most important criterion).
   Deferred: run equal-weighted first as baseline, then consider a
   theory-motivated (not tuned) weighting.

---

## Sign-off

Ready for Phase 1 ingestion once:

- [ ] User reviews and either signs off or amends
- [ ] Open questions #1 and #3 have a punt-able Phase-1 answer (they do — deferred
      until Phase 4 and Phase 3 respectively)
- [ ] `emerging_re/` directory scaffolded with empty subdirectories
- [ ] `pyproject.toml` initialized with dependencies (duckdb, dbt-duckdb,
      pandas, httpx, pyarrow)

Once signed off, Phase 1 starts with the FHFA HPI loader as the simplest source
that exercises the full pipeline shape (raw snapshot → FIPS normalize → land
in Parquet with bitemporal keys).
