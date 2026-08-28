"""Probe the HUD USPS NCWM API to discover its actual parameter shape.

We know from public docs:
- Base URL: https://www.huduser.gov/hudapi/public/uspsncwm
- Auth: Authorization: Bearer <token>
- Example uses `type`, `year`, `month`, `tractid`

Open questions this script answers:
- Does the API accept state-level / county-level queries, or is it per-tract only?
- What `type` values exist and what do they represent?
- What does a successful response body look like (JSON schema)?
- What history is available (which years/months work)?

Run: `uv run python scripts/probe_hud.py`
Requires HUD_API_TOKEN in ../.env
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import httpx


NCWM_URL = "https://www.huduser.gov/hudapi/public/uspsncwm"  # vacancy data (restricted)
XWALK_URL = "https://www.huduser.gov/hudapi/public/usps"     # ZIP crosswalks (public)

# One known tract in DC (11001008410) — used in HUD's own doc example.
# Franklin County OH = FIPS 39049; picking a real tract there for a county probe.
SAMPLE_TRACT_DC = "11001008410"
SAMPLE_TRACT_FRANKLIN_OH = "39049001100"
SAMPLE_STATE_OH = "39"
SAMPLE_COUNTY_FRANKLIN_OH = "39049"


def _load_token() -> str:
    env_path = Path(__file__).parent.parent / ".env"
    if not env_path.exists():
        print(f"FATAL: {env_path} not found. Create it with HUD_API_TOKEN=<your token>")
        sys.exit(1)
    for line in env_path.read_text().splitlines():
        if line.startswith("HUD_API_TOKEN="):
            token = line.split("=", 1)[1].strip().strip('"').strip("'")
            if not token or token == "PASTE_YOUR_TOKEN_HERE":
                print(f"FATAL: HUD_API_TOKEN in {env_path} is empty or still a placeholder")
                sys.exit(1)
            return token
    print(f"FATAL: HUD_API_TOKEN= not found in {env_path}")
    sys.exit(1)


def _call(token: str, label: str, params: dict, url: str = NCWM_URL) -> None:
    print(f"\n=== {label} ===")
    print(f"    url:    {url}")
    print(f"    params: {params}")
    try:
        r = httpx.get(
            url,
            headers={"Authorization": f"Bearer {token}"},
            params=params,
            timeout=30.0,
        )
    except httpx.HTTPError as e:
        print(f"    HTTP ERROR: {e}")
        return
    print(f"    HTTP {r.status_code}, {len(r.content)} bytes")
    body = r.text
    if r.status_code == 200:
        try:
            data = r.json()
            # Print a compact preview: top-level keys + record count if list-shaped
            if isinstance(data, dict):
                print(f"    top-level keys: {list(data.keys())}")
                for k, v in list(data.items())[:8]:
                    if isinstance(v, list):
                        print(f"      {k}: list of {len(v)}")
                        if v:
                            print(f"        first item keys: {list(v[0].keys()) if isinstance(v[0], dict) else type(v[0]).__name__}")
                    else:
                        preview = str(v)[:120]
                        print(f"      {k}: {preview}")
            elif isinstance(data, list):
                print(f"    list of {len(data)} items")
                if data:
                    print(f"      first item: {json.dumps(data[0], indent=2)[:400]}")
        except json.JSONDecodeError:
            print(f"    body (not JSON): {body[:400]}")
    else:
        print(f"    body: {body[:400]}")


def main() -> None:
    token = _load_token()
    print(f"Loaded token (length={len(token)}, first 6 chars={token[:6]}...)")

    print("\n" + "=" * 60)
    print("PART 1 — CROSSWALK API (public, no eligibility restriction)")
    print("=" * 60)

    # A. Crosswalk: ZIP → county (type=2 per public doc examples).
    #    Sample query for ZIP 22031 (Fairfax VA).
    _call(token, "A. Crosswalk: ZIP 22031 → counties", {
        "type": 2, "query": "22031",
    }, url=XWALK_URL)

    # B. Crosswalk: ZIP → tract (type=1).
    _call(token, "B. Crosswalk: ZIP 22031 → tracts", {
        "type": 1, "query": "22031",
    }, url=XWALK_URL)

    print("\n" + "=" * 60)
    print("PART 2 — NCWM VACANCY API (eligibility-restricted)")
    print("=" * 60)

    # 1. Doc example: tract-level vacancy for a DC tract.
    _call(token, "1. Doc example: type=1 tract DC 2024-03", {
        "type": 1, "year": 2024, "month": 3, "tractid": SAMPLE_TRACT_DC,
    })

    # 2. **CRITICAL** — state-level query (per docs, stateid returns all tracts
    #    in the state in one call). If this works, ~51 calls per quarter
    #    covers the whole country instead of 84K.
    _call(token, "2. type=1 STATE-LEVEL bulk Ohio 2024-03", {
        "type": 1, "year": 2024, "month": 3, "stateid": SAMPLE_STATE_OH,
    })

    # 3. Enumerate `type` values (2=Tenant, 5=LIHTC are useful for framework).
    for t in (2, 5):
        _call(token, f"3.{t} type={t} tract Amherst VA 2024-03", {
            "type": t, "year": 2024, "month": 3, "tractid": "51009010201",
        })

    # 5. History bounds.
    _call(token, "5. History probe: 2005-06 (earliest cited in docs)", {
        "type": 1, "year": 2005, "month": 6, "tractid": SAMPLE_TRACT_DC,
    })

    # 6. Latest available.
    _call(token, "6. Latest probe: 2026-06", {
        "type": 1, "year": 2026, "month": 6, "tractid": SAMPLE_TRACT_DC,
    })


if __name__ == "__main__":
    main()
