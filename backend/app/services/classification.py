"""AI-powered activity classification using Gemini."""
from __future__ import annotations

import json
import logging
from dataclasses import dataclass, field
from typing import Protocol, runtime_checkable

from google import genai
from google.genai import types
from pydantic import BaseModel

from app.config import Settings, get_settings

logger = logging.getLogger(__name__)

# Hard-coded REPS category taxonomy aligned with IRC § 469(c)(7)
REPS_CATEGORIES: list[dict] = [
    {"name": "Property Management",          "type": "material"},
    {"name": "Tenant & Lease Management",    "type": "material"},
    {"name": "Construction & Reconstruction","type": "material"},
    {"name": "Specific Due Diligence",       "type": "material"},
    {"name": "Vendor/Contractor Supervision","type": "material"},
    {"name": "Financial Recordkeeping",      "type": "non-material"},
    {"name": "Education & Research",         "type": "non-material"},
    {"name": "General Travel",               "type": "non-material"},
]

_VALID_CATEGORY_NAMES = {c["name"] for c in REPS_CATEGORIES}
_AUDIT_STRENGTHS = {"high", "medium", "low"}

# Static system instruction — sent once per request, not inlined in user message
_SYSTEM_INSTRUCTION = (
    "You are a Real Estate Tax Compliance Expert specializing in Internal Revenue Code "
    "Section 469(c)(7) and Treasury Regulation § 1.469-5T. Your goal is to classify "
    "real estate activities to qualify for Real Estate Professional Status (REPS) and "
    "meet Material Participation tests.\n\n"
    "AVAILABLE CATEGORIES — pick exactly one:\n"
    + "\n".join(f'  - "{c["name"]}" ({c["type"]})' for c in REPS_CATEGORIES)
    + "\n\n"
    "CLASSIFICATION RULES:\n"
    "- Material Participation: Activities involving operations, management, construction, "
    "or tenant relations. Must be regular, continuous, and substantial.\n"
    "- Non-Material (Investor): Administrative or high-level tasks that do NOT count "
    "toward the 750-hour REPS requirement (bookkeeping, research, education, passive "
    "travel). These carry High Audit Risk.\n"
    "- If the activity involves actively directing people or making real-time decisions "
    "about the property, it is Material — even over the phone or in a meeting.\n\n"
    "Return valid JSON only — no markdown fences, no extra text. Required keys:\n"
    '{"refined_title","refined_description","evidence_note","category_name","type",'
    '"audit_strength","justification","audit_tip"}\n\n'
    "Rules:\n"
    "- category_name: verbatim from the list above, OR null to suggest a new category\n"
    "- type: exactly \"material\" or \"non-material\"\n"
    "- audit_strength: \"high\" (core REPS), \"medium\" (needs detail), or \"low\" (weak/non-qualifying)\n"
    "- Non-material activities must have low or medium audit_strength\n"
    "- If proposing a new category (confidence < 0.6), set category_name to null and "
    "add suggested_new_category: \"<2-5 word name>\""
)

_USER_PROMPT_TEMPLATE = (
    'ACTIVITY: "{description}"\n\n'
    "Respond with JSON matching this shape:\n"
    '{{\n'
    '  "refined_title": "Audit-ready title",\n'
    '  "refined_description": "Purpose: [...]. Result: [...].",\n'
    '  "evidence_note": "Cite or attach: [documents/photos/invoices/emails].",\n'
    '  "category_name": "Property Management",\n'
    '  "type": "material",\n'
    '  "audit_strength": "high",\n'
    '  "justification": "One sentence under IRC § 469(c)(7).",\n'
    '  "audit_tip": "One specific documentation suggestion."\n'
    "}}"
)


class ClassificationResult(BaseModel):
    refined_title: str
    refined_description: str          # Purpose + Result only
    evidence_note: str                # Evidence suggestion (pre-fills the Notes field)
    category_name: str | None         # null when suggesting a brand-new category
    suggested_new_category: str | None = None  # set when category_name is null
    type: str                         # "material" or "non-material"
    audit_strength: str               # "high", "medium", or "low"
    justification: str
    audit_tip: str


@runtime_checkable
class ActivityClassifier(Protocol):
    """Protocol for activity classifiers (Open/Closed principle)."""

    async def classify(self, description: str) -> ClassificationResult:
        ...


@dataclass
class GeminiActivityClassifier:
    """Classifies REPS activities using Gemini."""

    api_key: str
    _client: genai.Client = field(init=False, default=None)

    def _get_client(self) -> genai.Client:
        """Return cached client, creating it once on first use."""
        if self._client is None:
            self._client = genai.Client(api_key=self.api_key)
        return self._client

    async def classify(self, description: str) -> ClassificationResult:
        client = self._get_client()
        prompt = _USER_PROMPT_TEMPLATE.format(description=description)

        try:
            response = await client.aio.models.generate_content(
                model="gemini-2.5-flash",
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=_SYSTEM_INSTRUCTION,
                    response_mime_type="application/json",
                    temperature=0,
                    thinking_config=types.ThinkingConfig(thinking_budget=0),
                ),
            )
            raw = response.text.strip()
            logger.debug("Gemini raw response: %s", raw)
            data = json.loads(raw)

            raw_category = data.get("category_name")
            suggested_new = data.get("suggested_new_category")
            suggested_new_str = str(suggested_new).strip() if suggested_new else None

            raw_type = str(data.get("type", "")).lower().strip()
            participation_type = raw_type if raw_type in ("material", "non-material") else "material"
            if raw_type not in ("material", "non-material"):
                logger.warning("Unexpected type value from Gemini: %r", raw_type)

            raw_strength = str(data.get("audit_strength", "")).lower().strip()
            audit_strength = raw_strength if raw_strength in _AUDIT_STRENGTHS else "medium"

            shared_fields = dict(
                refined_title=str(data.get("refined_title", description)).strip() or description,
                refined_description=str(data.get("refined_description", "")).strip(),
                evidence_note=str(data.get("evidence_note", "")).strip(),
                type=participation_type,
                audit_strength=audit_strength,
                justification=str(data.get("justification", "")).strip(),
                audit_tip=str(data.get("audit_tip", "")).strip(),
            )

            # Path 1: AI suggests a brand-new category
            if raw_category is None and suggested_new_str:
                logger.debug("Gemini suggests new category %r", suggested_new_str)
                return ClassificationResult(
                    **shared_fields,
                    category_name=None,
                    suggested_new_category=suggested_new_str,
                )

            # Path 2: AI picks from the fixed REPS taxonomy
            category_name = str(raw_category or "").strip()
            if category_name not in _VALID_CATEGORY_NAMES:
                logger.warning("Gemini returned unknown category %r; falling back", category_name)
                return self._fallback()

            return ClassificationResult(
                **shared_fields,
                category_name=category_name,
                suggested_new_category=None,
            )
        except Exception as exc:
            logger.warning("Gemini classification failed: %s", exc)
            return self._fallback()

    def _fallback(self) -> ClassificationResult:
        return ClassificationResult(
            refined_title="Unclassified Activity",
            refined_description="",
            evidence_note="",
            category_name="Property Management",
            suggested_new_category=None,
            type="material",
            audit_strength="low",
            justification="AI classification unavailable; please review and update manually.",
            audit_tip="Add specific details: property address, date, people involved, and outcome of the activity.",
        )


def get_classifier(settings: Settings = None) -> GeminiActivityClassifier:
    """Factory function for the classifier (for use with FastAPI Depends)."""
    if settings is None:
        settings = get_settings()
    return GeminiActivityClassifier(api_key=settings.gemini_api_key)
