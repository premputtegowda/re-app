"""Add ai_assumptions_data JSON column to saved_deals.

Revision ID: 0014
Revises: 0013
Create Date: 2026-08-25
"""
import sqlalchemy as sa
from alembic import op

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "saved_deals",
        sa.Column("ai_assumptions_data", sa.JSON, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("saved_deals", "ai_assumptions_data")
