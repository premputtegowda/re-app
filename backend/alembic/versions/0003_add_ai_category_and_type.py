"""add ai_category_id and ai_type to entries

Revision ID: 0003
Revises: 0002
Create Date: 2026-03-22
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("entries", sa.Column(
        "ai_category_id",
        UUID(as_uuid=True),
        sa.ForeignKey("categories.id", ondelete="SET NULL"),
        nullable=True,
    ))
    op.add_column("entries", sa.Column("ai_type", sa.String(20), nullable=True))


def downgrade() -> None:
    op.drop_column("entries", "ai_type")
    op.drop_column("entries", "ai_category_id")
