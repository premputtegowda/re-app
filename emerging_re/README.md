# Macro Monitoring Rules — CRE Deployment Decisions

Weekly credit and regime tripwires. Established while thinking clearly; follow mechanically when they trigger.

---

## The 5 signals to watch (bookmark all)

| Signal | FRED code | URL | Cadence | Purpose |
|---|---|---|---|---|
| **BAA corporate spread** | `BAA10Y` | https://fred.stlouisfed.org/series/BAA10Y | Daily (check weekly) | Credit stress — earliest recession warning |
| **30yr mortgage rate** | `MORTGAGE30US` | https://fred.stlouisfed.org/series/MORTGAGE30US | Weekly | Directly affects DSCR on new deals |
| **10Y-2Y yield curve** | `T10Y2Y` | https://fred.stlouisfed.org/series/T10Y2Y | Daily | Recession indicator (inverted = 6-18mo warning) |
| **Unemployment rate** | `UNRATE` | https://fred.stlouisfed.org/series/UNRATE | Monthly | Labor market health |
| **CRE loan delinquency** | `DRCLACBS` | https://fred.stlouisfed.org/series/DRCLACBS | Quarterly | Distress in CRE lending specifically |

---

## Weekly routine (5 minutes, Sunday morning)

1. Open each FRED page above
2. For each: note current value + trend direction over last 4-8 weeks
3. Focus on the **4-week moving average**, not the daily value
4. Compare against the threshold ladders below
5. Act only on **sustained crossings** (2+ weeks above threshold), not single spikes

Optional: sign up for FRED email alerts to get notified when new observations post.

---

## BAA10Y (BAA corporate spread) — primary tripwire

Historical mean 2.26%, median 2.13%, min 1.16% (1989), max 6.16% (2008).

| BAA10Y (4-week average) | Regime | Action |
|---|---|---|
| **< 1.5%** | Ultra-tight, complacent | Active deployment |
| **1.5 - 2.0%** | Normal-tight | Weekly monitoring, no action |
| **2.0 - 2.5%** | Slightly stressed | Tighten underwriting, defer marginal deals |
| **2.5 - 3.0%** | Real credit stress emerging | Pause new deployment, start distress shopping list |
| **> 3.0%** | Significant stress (2018 peak was 2.5%; 2020 hit 4.4%) | Recession likely within 6-12mo, position defensively |
| **> 5.0%** | Financial crisis territory | Deploy dry powder into distressed opportunities |

**Rate of change also matters:**
- Weekly move < 10bp = noise, ignore
- 4-week move > 25bp = investigate
- 4-week move > 50bp = real regime shift starting

---

## Mechanical deployment rules

Set these thresholds NOW. Follow them when they trigger, even if the market "feels fine."

### IF BAA10Y (4-week average) > 2.5%:
- Pause new MF acquisitions
- Review existing holdings for refinancing exposure
- Build shopping list for distressed opportunities

### IF BAA10Y (4-week average) crosses 3.0%:
- No new full-price acquisitions
- Only distressed / off-market at 15%+ discount
- Increase cash reserve to 20%+ of AUM

### IF BAA10Y (4-week average) crosses 4.0%:
- Recession likely within 6-12 months
- Deploy dry powder into best distressed opportunities
- Extend hold assumptions to 7-10 years to wait out cycle

---

## Companion signal thresholds

### Mortgage 30yr (`MORTGAGE30US`)
- **> 7.5% sustained (4+ weeks)** = new deals need cap rate ≥ 6.5% to make DSCR work

### Yield curve (`T10Y2Y`)
- **< 0 (inverted) for 4+ weeks** = 6-18mo recession warning (leads BAA10Y typically)

### Unemployment (`UNRATE`)
- **Rising 0.5pp+ over 3 months** = labor market breaking, recession forming

### CRE delinquency (`DRCLACBS`)
- **> 4%** = CRE stress building (currently 2.63%; historical range 1-11%; 2010 peak 8.9%)

---

## Interpreting combined signals

**When BAA10Y AND mortgage rate AND yield curve all move together in same direction over 4+ weeks**, that's a real regime signal. Any one alone is noise.

**Example benign combo (today):**
- BAA10Y 1.39% (near record low)
- Mortgage 6.7%
- Yield curve normal
- Unemployment stable
- CRE delinq 2.63%

Result: MID CYCLE regime, active deployment posture defensible.

**Example warning combo:**
- BAA10Y widening 25bp/month for 3 months
- Mortgage rising 50bp
- Yield curve flattening toward inversion
- Unemployment rising 0.3pp/month

Result: LATE CYCLE forming, shift to defensive positioning.

---

## Why write this down now

Credit spread cycles are the single biggest place investors talk themselves into ignoring warning signs.

- 2007 Q1: BAA10Y was 1.8%. By 2008 Q4 it hit 6.16%. Investors who kept buying through Q1-Q3 2007 got destroyed.
- 1998 Q3: LTCM crisis pushed BAA10Y from 1.6% → 2.9% in weeks. Recovery followed but many missed the warning.

The pattern: spreads widen, investors find reasons to keep buying, then the crash validates the signal. **Pre-committing to mechanical thresholds is the defense.**

---

## Investment framework quick reference

Current 2025 picks (as of MID CYCLE regime, BAA10Y 1.39%):

**Primary recommendation (intersection VALUE ∩ LEADING):**
1. Marion, IN (Indianapolis) — 6.07% cap, RRS 6.10, real MSA scale
2. Pasco, FL (Tampa suburb) — 6.15% cap, RRS 4.00, bubble-vulnerable
3. Pinal, AZ (Phoenix exurb) — 5.68% cap, RRS 4.30, bubble-vulnerable

**Defensive alternatives (VALUE picks, high RRS):**
- Lubbock, TX — 6.52% cap, RRS 7.50 (highest RRS)
- Nueces, TX — 7.01% cap, RRS 6.60
- El Paso, TX — 7.08% cap, RRS 6.10

**When BAA10Y triggers warning thresholds**: shift allocation from bubble-vulnerable picks (Pasco FL, Pinal AZ) toward recession-resilient Texas picks (Lubbock, Nueces, El Paso) which held up in 2007-2010.
