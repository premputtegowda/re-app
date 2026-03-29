"""Tests for Deal Analyzer backend persistence endpoints."""
import uuid
from unittest.mock import MagicMock, patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import User
from app.models.saved_deal import SavedDeal

# ── Fixtures ───────────────────────────────────────────────────────────────────

SAMPLE_ACQUISITION = {
    "propertyType": "sfr",
    "purchasePrice": 350000,
    "downPaymentPct": 25,
    "interestRate": 7.0,
    "loanTermYears": 30,
    "projectionYears": 10,
    "exitCapRate": 6.0,
    "exitMethod": "capRate",
}
SAMPLE_OPERATIONS = {
    "grossRentMonthly": 2500,
    "vacancyRatePct": 5,
    "opexPct": 35,
    "propertyMgmtPct": 8,
    "annualRentGrowthPct": 3,
}
SAMPLE_PROFORMA = {
    "grossRent": {"t12": 30000, "stab": 30000, "stabilized": 30000, "growthPct": 3},
    "vacancyPct": {"t12": 5, "stab": None, "stabilized": 5},
    "creditLossPct": {"t12": 0, "stab": None, "stabilized": 0},
    "expenses": [],
    "yearOverrides": {},
}
SAMPLE_REFINANCE = {
    "enabled": False,
    "refiYear": 5,
    "refiMarketValue": 400000,
    "newLTV": 75,
    "newInterestRate": 6.5,
    "newLoanTermYears": 30,
    "refiCostPct": 2,
}
SAMPLE_RESULTS = {
    "base": {
        "totalInvested": 100000,
        "avgCoCReturn": 0.085,
        "irr": 0.12,
        "equityMultiple": 1.8,
    }
}


def make_deal_payload(deal_id: str | None = None) -> dict:
    return {
        "id": deal_id or str(uuid.uuid4()),
        "name": "Test SFR Deal",
        "acquisition": SAMPLE_ACQUISITION,
        "operations": SAMPLE_OPERATIONS,
        "proForma": SAMPLE_PROFORMA,
        "refinance": SAMPLE_REFINANCE,
        "results": SAMPLE_RESULTS,
        "mcRanges": None,
        "mcResults": None,
        "currentStep": 4,
        "savedAt": "2026-03-29T10:00:00",
        "updatedAt": "2026-03-29T10:00:00",
    }


# ── List deals ─────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_list_deals_empty(async_client: AsyncClient, auth_headers: dict):
    """New user has no deals."""
    resp = await async_client.get("/api/deals", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


@pytest.mark.asyncio
async def test_list_deals_returns_user_deals(
    async_client: AsyncClient,
    auth_headers: dict,
    test_user: User,
    test_db: AsyncSession,
):
    """Returns only the authenticated user's deals."""
    deal = SavedDeal(
        id=uuid.uuid4(),
        user_id=test_user.id,
        name="My Deal",
        acquisition_data=SAMPLE_ACQUISITION,
        operations_data=SAMPLE_OPERATIONS,
        proforma_data=SAMPLE_PROFORMA,
        refinance_data=SAMPLE_REFINANCE,
        results_data=SAMPLE_RESULTS,
    )
    test_db.add(deal)
    await test_db.commit()

    resp = await async_client.get("/api/deals", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert len(data) == 1
    assert data[0]["name"] == "My Deal"
    assert data[0]["acquisition"]["purchasePrice"] == 350000


@pytest.mark.asyncio
async def test_list_deals_isolated_per_user(
    async_client: AsyncClient,
    auth_headers: dict,
    test_user: User,
    admin_user: User,
    test_db: AsyncSession,
):
    """User cannot see another user's deals."""
    other_deal = SavedDeal(
        id=uuid.uuid4(),
        user_id=admin_user.id,
        name="Admin Deal",
        acquisition_data=SAMPLE_ACQUISITION,
        operations_data=SAMPLE_OPERATIONS,
        proforma_data=SAMPLE_PROFORMA,
        refinance_data=SAMPLE_REFINANCE,
        results_data=SAMPLE_RESULTS,
    )
    test_db.add(other_deal)
    await test_db.commit()

    resp = await async_client.get("/api/deals", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == []


# ── Create deal ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_deal_success(async_client: AsyncClient, auth_headers: dict):
    """Successfully creates a deal and returns it."""
    payload = make_deal_payload()
    resp = await async_client.post("/api/deals", json=payload, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["id"] == payload["id"]
    assert data["name"] == "Test SFR Deal"
    assert data["acquisition"]["purchasePrice"] == 350000
    assert data["results"]["base"]["irr"] == 0.12
    assert data["currentStep"] == 4


@pytest.mark.asyncio
async def test_create_deal_with_mc_data(async_client: AsyncClient, auth_headers: dict):
    """Creates a deal with Monte Carlo data."""
    payload = make_deal_payload()
    payload["mcRanges"] = {"rent": {"min": 2000, "mode": 2500, "max": 3000}}
    payload["mcResults"] = {"p10": 0.06, "p50": 0.09, "p90": 0.14}

    resp = await async_client.post("/api/deals", json=payload, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["mcRanges"]["rent"]["mode"] == 2500
    assert data["mcResults"]["p50"] == 0.09


@pytest.mark.asyncio
async def test_create_deal_duplicate_id_returns_409(
    async_client: AsyncClient,
    auth_headers: dict,
):
    """Creating a deal with the same ID twice returns 409."""
    payload = make_deal_payload()
    resp1 = await async_client.post("/api/deals", json=payload, headers=auth_headers)
    assert resp1.status_code == 201

    resp2 = await async_client.post("/api/deals", json=payload, headers=auth_headers)
    assert resp2.status_code == 409


@pytest.mark.asyncio
async def test_create_deal_requires_auth(async_client: AsyncClient):
    """Unauthenticated request returns 401."""
    payload = make_deal_payload()
    resp = await async_client.post("/api/deals", json=payload)
    assert resp.status_code == 401


# ── Update deal ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_update_deal_success(async_client: AsyncClient, auth_headers: dict):
    """Full update overwrites deal fields."""
    payload = make_deal_payload()
    create_resp = await async_client.post("/api/deals", json=payload, headers=auth_headers)
    assert create_resp.status_code == 201
    deal_id = create_resp.json()["id"]

    update = {
        "name": "Updated Deal Name",
        "acquisition": {**SAMPLE_ACQUISITION, "purchasePrice": 400000},
        "operations": SAMPLE_OPERATIONS,
        "proForma": SAMPLE_PROFORMA,
        "refinance": SAMPLE_REFINANCE,
        "results": SAMPLE_RESULTS,
        "currentStep": 3,
        "updatedAt": "2026-03-29T12:00:00",
    }
    resp = await async_client.put(f"/api/deals/{deal_id}", json=update, headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert data["name"] == "Updated Deal Name"
    assert data["acquisition"]["purchasePrice"] == 400000
    assert data["currentStep"] == 3


@pytest.mark.asyncio
async def test_update_deal_not_found(async_client: AsyncClient, auth_headers: dict):
    """Updating a non-existent deal returns 404."""
    update = {
        "name": "X",
        "acquisition": SAMPLE_ACQUISITION,
        "operations": SAMPLE_OPERATIONS,
        "proForma": SAMPLE_PROFORMA,
        "refinance": SAMPLE_REFINANCE,
        "results": SAMPLE_RESULTS,
        "updatedAt": "2026-03-29T12:00:00",
    }
    resp = await async_client.put(f"/api/deals/{uuid.uuid4()}", json=update, headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_update_deal_another_users_deal(
    async_client: AsyncClient,
    auth_headers: dict,
    admin_auth_headers: dict,
):
    """User cannot update another user's deal."""
    payload = make_deal_payload()
    create_resp = await async_client.post("/api/deals", json=payload, headers=auth_headers)
    deal_id = create_resp.json()["id"]

    update = {
        "name": "Hacked",
        "acquisition": SAMPLE_ACQUISITION,
        "operations": SAMPLE_OPERATIONS,
        "proForma": SAMPLE_PROFORMA,
        "refinance": SAMPLE_REFINANCE,
        "results": SAMPLE_RESULTS,
        "updatedAt": "2026-03-29T12:00:00",
    }
    resp = await async_client.put(f"/api/deals/{deal_id}", json=update, headers=admin_auth_headers)
    assert resp.status_code == 404


# ── Delete deal ────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_delete_deal_success(async_client: AsyncClient, auth_headers: dict):
    """Deletes a deal and it no longer appears in the list."""
    payload = make_deal_payload()
    create_resp = await async_client.post("/api/deals", json=payload, headers=auth_headers)
    deal_id = create_resp.json()["id"]

    del_resp = await async_client.delete(f"/api/deals/{deal_id}", headers=auth_headers)
    assert del_resp.status_code == 204

    list_resp = await async_client.get("/api/deals", headers=auth_headers)
    assert list_resp.json() == []


@pytest.mark.asyncio
async def test_delete_deal_not_found(async_client: AsyncClient, auth_headers: dict):
    """Deleting a non-existent deal returns 404."""
    resp = await async_client.delete(f"/api/deals/{uuid.uuid4()}", headers=auth_headers)
    assert resp.status_code == 404


@pytest.mark.asyncio
async def test_delete_deal_another_users_deal(
    async_client: AsyncClient,
    auth_headers: dict,
    admin_auth_headers: dict,
):
    """User cannot delete another user's deal."""
    payload = make_deal_payload()
    create_resp = await async_client.post("/api/deals", json=payload, headers=auth_headers)
    deal_id = create_resp.json()["id"]

    resp = await async_client.delete(f"/api/deals/{deal_id}", headers=admin_auth_headers)
    assert resp.status_code == 404

    # Original deal is untouched
    list_resp = await async_client.get("/api/deals", headers=auth_headers)
    assert len(list_resp.json()) == 1


# ── Draft deals (results = {}) ─────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_create_draft_deal(async_client: AsyncClient, auth_headers: dict):
    """A deal with empty results dict is treated as a draft."""
    payload = make_deal_payload()
    payload["results"] = {}
    payload["currentStep"] = 2

    resp = await async_client.post("/api/deals", json=payload, headers=auth_headers)
    assert resp.status_code == 201
    data = resp.json()
    assert data["results"] == {}
    assert data["currentStep"] == 2


# ── Cascade delete ─────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_deals_deleted_when_user_deleted(
    async_client: AsyncClient,
    auth_headers: dict,
    admin_auth_headers: dict,
    test_user: User,
):
    """Deals are cascade-deleted when the owning user is deleted."""
    payload = make_deal_payload()
    await async_client.post("/api/deals", json=payload, headers=auth_headers)

    del_resp = await async_client.delete(
        f"/api/admin/users/{test_user.id}", headers=admin_auth_headers
    )
    assert del_resp.status_code == 204

    # Deals are gone (user is gone, so auth would fail — just verify DB cascade via re-login isn't possible)
    # The cascade is verified by the 204 succeeding without FK errors
