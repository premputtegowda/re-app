"""Generate a professional, persuasive Letter of Intent PDF from deal data."""
from __future__ import annotations

from datetime import date
from io import BytesIO

from fpdf import FPDF

# ── Layout constants ──────────────────────────────────────────────────────────
MARGIN_L = 22
MARGIN_R = 22
MARGIN_T = 18
LINE_H = 5.5
BODY_FONT = "Helvetica"
PAGE_W = 215.9
CONTENT_W = PAGE_W - MARGIN_L - MARGIN_R


# ── Helpers ───────────────────────────────────────────────────────────────────

def _fmt_currency(value: float) -> str:
    return f"${value:,.0f}"


def _fmt_date(iso: str) -> str:
    try:
        y, m, d = iso.split("-")
        months = [
            "", "January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December",
        ]
        return f"{months[int(m)]} {int(d)}, {y}"
    except Exception:
        return iso


# ── Document class ────────────────────────────────────────────────────────────

class _LOIDoc(FPDF):
    def header(self):
        self.set_fill_color(30, 64, 175)
        self.rect(0, 0, PAGE_W, 3, "F")
        self.ln(6)
        self.set_font(BODY_FONT, "B", 13)
        self.set_text_color(30, 64, 175)
        self.cell(0, 7, "LETTER OF INTENT", align="C", ln=True)
        self.set_font(BODY_FONT, "", 8)
        self.set_text_color(100, 100, 100)
        self.cell(0, 5, "Real Estate Purchase Offer", align="C", ln=True)
        self.set_draw_color(200, 210, 240)
        self.set_line_width(0.3)
        self.line(MARGIN_L, self.get_y() + 1, PAGE_W - MARGIN_R, self.get_y() + 1)
        self.set_text_color(0, 0, 0)
        self.ln(5)

    def footer(self):
        self.set_y(-13)
        self.set_font(BODY_FONT, "I", 7.5)
        self.set_text_color(160, 160, 160)
        self.cell(
            0, 5,
            "This Letter of Intent is non-binding and for discussion purposes only.  "
            f"Page {self.page_no()}",
            align="C",
        )
        self.set_text_color(0, 0, 0)


def _section_header(pdf: FPDF, title: str) -> None:
    pdf.ln(2)
    pdf.set_font(BODY_FONT, "B", 8)
    pdf.set_fill_color(237, 242, 255)
    pdf.set_text_color(30, 64, 175)
    pdf.cell(0, 6, f"  {title}", fill=True, ln=True)
    pdf.set_text_color(0, 0, 0)
    pdf.ln(1)


def _kv(pdf: FPDF, label: str, value: str, label_w: float = 68) -> None:
    pdf.set_font(BODY_FONT, "B", 9)
    pdf.cell(label_w, LINE_H, label)
    pdf.set_font(BODY_FONT, "", 9)
    pdf.cell(0, LINE_H, value, ln=True)


def _body(pdf: FPDF, text: str, size: float = 9) -> None:
    pdf.set_font(BODY_FONT, "", size)
    pdf.multi_cell(0, LINE_H, text.strip())


# ── Main generator ────────────────────────────────────────────────────────────

def generate_loi_pdf(
    *,
    property_address: str,
    buyer_name: str,
    buying_entity: str,
    purchase_price: float,
    earnest_money: float,
    close_date: str,
    contingency_financing: bool,
    contingency_inspection: bool,
    contingency_appraisal: bool,
    additional_terms: str,
    signers: list[dict],
    property_type: str = "sfr",
    units: int = 1,
    beds: int = 0,
    baths: float = 0,
    down_payment_pct: float = 20.0,
) -> bytes:

    pdf = _LOIDoc(orientation="P", unit="mm", format="Letter")
    pdf.set_margins(MARGIN_L, MARGIN_T, MARGIN_R)
    pdf.set_auto_page_break(auto=True, margin=18)
    pdf.add_page()

    today = date.today().strftime("%B %d, %Y")
    buyer_ref = buying_entity.strip() if buying_entity.strip() else buyer_name
    is_mfr = property_type == "mfr" and units > 1
    down_pct = int(round(down_payment_pct))

    if is_mfr:
        property_desc = f"the {units}-unit multifamily property"
    elif beds and baths:
        property_desc = f"the {int(beds)}-bedroom, {baths:g}-bathroom single-family residence"
    else:
        property_desc = "the above-referenced property"

    # ── Date + RE line ────────────────────────────────────────────────────────
    pdf.set_font(BODY_FONT, "", 9)
    pdf.cell(0, LINE_H, today, ln=True)
    pdf.ln(2)
    pdf.set_font(BODY_FONT, "B", 9)
    pdf.cell(0, LINE_H, "RE:  Offer to Purchase", ln=True)
    pdf.set_font(BODY_FONT, "", 9)
    pdf.cell(0, LINE_H, f"     {property_address}", ln=True)
    pdf.ln(4)
    pdf.cell(0, LINE_H, "Dear Property Owner / Authorized Representative,", ln=True)
    pdf.ln(3)

    # ── Opening ───────────────────────────────────────────────────────────────
    opening = (
        f"We are writing to express our sincere and serious interest in acquiring "
        f"{property_desc} located at {property_address}. "
        f"After careful review and underwriting of this opportunity, {buyer_ref} is "
        f"pleased to present the following Letter of Intent outlining the proposed terms of purchase."
    )
    _body(pdf, opening)
    pdf.ln(2)

    commitment = (
        "We are committed buyers with the financial capacity and operational expertise "
        "to close this transaction efficiently. Our offer reflects a thorough analysis of "
        "the property's current condition, market comparables, and long-term income potential. "
        "We are prepared to move forward promptly upon mutual acceptance of these terms."
    )
    _body(pdf, commitment)

    # ── Proposed Terms ────────────────────────────────────────────────────────
    _section_header(pdf, "PROPOSED PURCHASE TERMS")
    _kv(pdf, "Buyer:", buyer_ref)
    _kv(pdf, "Property:", property_address)
    _kv(pdf, "Offer Price:", _fmt_currency(purchase_price))
    _kv(pdf, "Earnest Money Deposit:", f"{_fmt_currency(earnest_money)}  (due within 3 business days of executed PSA)")
    _kv(pdf, "Proposed Close Date:", _fmt_date(close_date))
    _kv(pdf, "Down Payment:", f"Approximately {down_pct}% of purchase price")

    # ── Financing ─────────────────────────────────────────────────────────────
    _section_header(pdf, "FINANCING")
    if not contingency_financing:
        financing_text = (
            f"This offer is NOT subject to a financing contingency. "
            f"Buyer has confirmed available capital and/or committed financing sufficient to close "
            f"at the offered price with approximately {down_pct}% down. "
            f"Seller can be fully confident this transaction will not be delayed or jeopardized "
            f"by lending conditions."
        )
    else:
        financing_text = (
            f"Buyer intends to finance a portion of the purchase price with approximately "
            f"{down_pct}% down. This offer is subject to Buyer securing satisfactory financing "
            f"on or before the proposed close date. "
            f"Buyer is actively engaged with lenders and will provide proof of pre-approval "
            f"within 5 business days of mutual acceptance."
        )
    _body(pdf, financing_text)

    # ── Contingencies ─────────────────────────────────────────────────────────
    _section_header(pdf, "CONTINGENCIES")

    has_contingency = contingency_financing or contingency_inspection or contingency_appraisal
    if not has_contingency:
        _body(pdf, (
            "Buyer is offering with NO contingencies. This is a clean, as-is offer "
            "representing our highest confidence in the property and our ability to close. "
            "We believe this significantly strengthens our offer relative to contingent bids."
        ))
    else:
        if contingency_inspection:
            pdf.set_font(BODY_FONT, "B", 9)
            pdf.cell(0, LINE_H, "  Inspection Contingency:", ln=True)
            pdf.set_font(BODY_FONT, "", 9)
            pdf.set_x(MARGIN_L + 5)
            pdf.multi_cell(CONTENT_W - 5, LINE_H, (
                "Buyer shall have 10 business days from mutual acceptance to complete "
                "a physical inspection. Buyer agrees to work in good faith and will "
                "only request reasonable repairs or credits."
            ))
            pdf.ln(1)
        if contingency_appraisal:
            pdf.set_font(BODY_FONT, "B", 9)
            pdf.cell(0, LINE_H, "  Appraisal Contingency:", ln=True)
            pdf.set_font(BODY_FONT, "", 9)
            pdf.set_x(MARGIN_L + 5)
            pdf.multi_cell(CONTENT_W - 5, LINE_H, (
                "Subject to the property appraising at or above the offered purchase price "
                "by a licensed independent appraiser."
            ))
            pdf.ln(1)
        if contingency_financing:
            pdf.set_font(BODY_FONT, "B", 9)
            pdf.cell(0, LINE_H, "  Financing Contingency:", ln=True)
            pdf.set_font(BODY_FONT, "", 9)
            pdf.set_x(MARGIN_L + 5)
            pdf.multi_cell(CONTENT_W - 5, LINE_H, (
                "Subject to Buyer obtaining a written loan commitment at terms acceptable "
                "to Buyer within 21 days of mutual acceptance."
            ))
            pdf.ln(1)

    # ── Buyer Qualifications ──────────────────────────────────────────────────
    _section_header(pdf, "BUYER QUALIFICATIONS & COMMITMENT")

    strengths = []
    if not contingency_financing:
        strengths.append("confirmed capital with no financing risk to the seller")
    if not contingency_inspection:
        strengths.append("no inspection contingency, reflecting as-is acceptance")
    if not contingency_appraisal:
        strengths.append("no appraisal contingency")
    strengths.append("demonstrated experience acquiring and operating real estate")
    strengths.append("a proven track record of closing transactions on or ahead of schedule")

    strengths_str = "; ".join(strengths)
    qual_text = (
        f"We bring the following strengths to this transaction: {strengths_str}. "
        f"Upon acceptance of this LOI, we are prepared to deliver a fully executed "
        f"Purchase and Sale Agreement within 5 business days. We welcome any questions "
        f"and are available for a call at your earliest convenience."
    )
    _body(pdf, qual_text)

    # ── Additional Terms ──────────────────────────────────────────────────────
    if additional_terms.strip():
        _section_header(pdf, "ADDITIONAL TERMS & CONDITIONS")
        _body(pdf, additional_terms.strip())

    # ── Exclusivity & Expiration ──────────────────────────────────────────────
    _section_header(pdf, "EXCLUSIVITY & EXPIRATION")
    _body(pdf, (
        "We respectfully request a 5-business-day period of exclusivity from the date of "
        "this LOI to allow both parties to finalize the Purchase and Sale Agreement without "
        "disruption. This LOI shall expire if not accepted within 5 business days of the "
        "date shown above."
    ))

    # ── Non-binding disclaimer ────────────────────────────────────────────────
    _section_header(pdf, "NON-BINDING DISCLAIMER")
    pdf.set_font(BODY_FONT, "I", 8)
    pdf.set_text_color(90, 90, 90)
    pdf.multi_cell(0, 5, (
        "This Letter of Intent is intended solely to outline proposed terms for discussion "
        "purposes and does not constitute a binding contract or obligation on either party. "
        "A binding agreement will only arise upon the full execution of a formal Purchase "
        "and Sale Agreement by all parties. Either party may withdraw from negotiations at "
        "any time prior to execution of such agreement."
    ))
    pdf.set_text_color(0, 0, 0)
    pdf.ln(3)

    # ── Closing paragraph ─────────────────────────────────────────────────────
    _body(pdf, (
        "We appreciate your time and consideration. We are genuinely excited about this "
        "property and look forward to the opportunity to work with you toward a successful "
        "closing."
    ))
    pdf.ln(3)
    pdf.set_font(BODY_FONT, "", 9)
    pdf.cell(0, LINE_H, "Respectfully submitted,", ln=True)
    pdf.ln(8)

    # ── Signatures ────────────────────────────────────────────────────────────
    _section_header(pdf, "SIGNATURES")
    pdf.ln(2)
    for signer in signers:
        role = signer.get("role", "Signer")
        name = signer.get("name", "")
        pdf.set_font(BODY_FONT, "B", 9)
        pdf.cell(0, LINE_H, f"{role}:", ln=True)
        pdf.ln(1)
        pdf.set_font(BODY_FONT, "", 9)
        pdf.cell(90, LINE_H, "Signature: _______________________________")
        pdf.cell(0, LINE_H, "Date: ________________________", ln=True)
        pdf.ln(1)
        pdf.set_font(BODY_FONT, "B", 9)
        pdf.cell(0, LINE_H, f"Printed Name: {name}", ln=True)
        if buying_entity.strip():
            pdf.set_font(BODY_FONT, "", 9)
            pdf.cell(0, LINE_H, f"Entity: {buying_entity}", ln=True)
        pdf.ln(6)

    buf = BytesIO()
    pdf.output(buf)
    return buf.getvalue()
