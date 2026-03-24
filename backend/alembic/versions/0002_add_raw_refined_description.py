"""add raw_description and refined_description to entries

Revision ID: 0002
Revises: 0001
Create Date: 2026-03-22
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("entries", sa.Column("raw_description", sa.Text(), nullable=True))
    op.add_column("entries", sa.Column("refined_description", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("entries", "refined_description")
    op.drop_column("entries", "raw_description")
