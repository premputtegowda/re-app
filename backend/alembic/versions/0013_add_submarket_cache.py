"""Add submarket_cache table for AI grounding data.

Revision ID: 0013
Revises: 0012
Create Date: 2026-08-24
"""
import sqlalchemy as sa
from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "submarket_cache",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("submarket_key", sa.String(32), nullable=False),
        sa.Column("data_category", sa.String(64), nullable=False),
        sa.Column("payload", sa.JSON, nullable=False),
        sa.Column("fetched_at", sa.DateTime, nullable=False, server_default=sa.func.now()),
        sa.Column("expires_at", sa.DateTime, nullable=False),
        sa.UniqueConstraint("submarket_key", "data_category", name="uq_submarket_cache_key_category"),
    )
    op.create_index(
        "ix_submarket_cache_expires_at", "submarket_cache", ["expires_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_submarket_cache_expires_at", table_name="submarket_cache")
    op.drop_table("submarket_cache")
