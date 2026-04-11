"""Generate a Letter of Intent PDF from deal data."""
from __future__ import annotations

from datetime import date
from io import BytesIO

from fpdf import FPDF


class _LOIDoc(FPDF):
    """FPDF subclass with consistent header/footer."""

    def header(self):
        self.set_font("Helvetica", "B", 11)
        self.cell(0, 8, "LETTER OF INTENT - REAL ESTATE PURCHASE", align="C")
        self.set_draw_color(180, 180, 180)
        self.line(10, self.get_y() + 2, 200, self.get_y() + 2)
        self.ln(8)

    def footer(self):
        self.set_y(-12)
        self.set_font("Helvetica", "I", 8)
        self.set_text_color(150, 150, 150)
        self.cell(0, 5, f"Page {self.page_no()}", align="C")
        self.set_text_color(0, 0, 0)


def _fmt_currency(value: float) -> str:
    return f"${value:,.0f}"


def _section(pdf: FPDF, title: str):
    pdf.set_font("Helvetica", "B", 9)
    pdf.set_fill_color(240, 240, 240)
    pdf.cell(0, 6, f"  {title}", fill=True, ln=True)
    pdf.ln(1)


def _row(pdf: FPDF, label: str, value: str):
    pdf.set_font("Helvetica", "B", 9)
    pdf.cell(65, 6, label)
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 6, value, ln=True)


def generate_loi_pdf(
    *,
    property_address: str,
    buyer_name: str,
    purchase_price: float,
    earnest_money: float,
    close_date: str,
    contingency_financing: bool,
    contingency_inspection: bool,
    contingency_appraisal: bool,
    additional_terms: str,
    signers: list[dict],  # [{name, email, role}]
) -> bytes:
    """Return raw PDF bytes for the LOI."""

    pdf = _LOIDoc(orientation="P", unit="mm", format="Letter")
    pdf.set_auto_page_break(auto=True, margin=15)
    pdf.add_page()
    pdf.set_margins(15, 20, 15)

    # Date line
    pdf.set_font("Helvetica", "", 9)
    pdf.cell(0, 6, f"Date: {date.today().strftime('%B %d, %Y')}", ln=True)
    pdf.ln(3)

    # Introduction paragraph
    pdf.set_font("Helvetica", "", 9)
    intro = (
        f"This Letter of Intent (\"LOI\") is submitted by {buyer_name} (\"Buyer\") "
        f"expressing intent to purchase the property located at:"
    )
    pdf.multi_cell(0, 5, intro)
    pdf.ln(1)
    pdf.set_font("Helvetica", "B", 10)
    pdf.cell(0, 7, property_address, ln=True)
    pdf.ln(3)

    pdf.set_font("Helvetica", "", 9)
    pdf.multi_cell(
        0, 5,
        "The following terms are proposed in good faith. This LOI is non-binding and "
        "subject to execution of a formal Purchase and Sale Agreement satisfactory to both parties.",
    )
    pdf.ln(4)

    # Terms section
    _section(pdf, "PROPOSED TERMS")
    pdf.ln(1)
    _row(pdf, "Purchase Price:", _fmt_currency(purchase_price))
    _row(pdf, "Earnest Money Deposit:", _fmt_currency(earnest_money))
    _row(pdf, "Proposed Close Date:", close_date)
    pdf.ln(2)

    # Contingencies
    _section(pdf, "CONTINGENCIES")
    pdf.ln(1)
    _row(pdf, "Financing Contingency:", "Yes" if contingency_financing else "No")
    _row(pdf, "Inspection Contingency:", "Yes" if contingency_inspection else "No")
    _row(pdf, "Appraisal Contingency:", "Yes" if contingency_appraisal else "No")
    pdf.ln(2)

    # Additional terms
    if additional_terms.strip():
        _section(pdf, "ADDITIONAL TERMS")
        pdf.ln(1)
        pdf.set_font("Helvetica", "", 9)
        pdf.multi_cell(0, 5, additional_terms.strip())
        pdf.ln(2)

    # Disclaimer
    _section(pdf, "DISCLAIMER")
    pdf.ln(1)
    pdf.set_font("Helvetica", "I", 8)
    pdf.set_text_color(100, 100, 100)
    pdf.multi_cell(
        0, 4,
        "This Letter of Intent is not a binding contract and does not obligate either party "
        "to complete the transaction. It is intended solely to express the Buyer's general "
        "interest and proposed terms. A binding agreement will only be created upon execution "
        "of a formal Purchase and Sale Agreement signed by all parties.",
    )
    pdf.set_text_color(0, 0, 0)
    pdf.ln(4)

    # Signature section
    _section(pdf, "SIGNATURES")
    pdf.ln(4)

    for signer in signers:
        pdf.set_font("Helvetica", "B", 9)
        role_label = signer.get("role", "Signer")
        pdf.cell(0, 5, f"{role_label}: {signer['name']}", ln=True)
        pdf.ln(1)
        pdf.set_font("Helvetica", "", 9)
        pdf.cell(90, 5, "Signature: _______________________________")
        pdf.cell(0, 5, "Date: ___________________", ln=True)
        pdf.ln(6)

    buf = BytesIO()
    pdf.output(buf)
    return buf.getvalue()
