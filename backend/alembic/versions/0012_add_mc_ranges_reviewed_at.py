"""Add mc_ranges_reviewed_at to saved_deals.

Revision ID: 0012
Revises: 0011
Create Date: 2026-04-23
"""
import sqlalchemy as sa
from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Nullable — existing deals default to null ("never reviewed"). The Market
    # Uncertainty wizard step treats null as dirty and prompts on first open.
    op.add_column(
        "saved_deals",
        sa.Column("mc_ranges_reviewed_at", sa.DateTime, nullable=True),
    )


def downgrade() -> None:
    op.drop_column("saved_deals", "mc_ranges_reviewed_at")
