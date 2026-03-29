"""Add millage_confidence column to jurisdiction_tax_data

Revision ID: 0006
Revises: 0005
Create Date: 2026-03-28
"""
from alembic import op
import sqlalchemy as sa

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'jurisdiction_tax_data',
        sa.Column('millage_confidence', sa.String(16), nullable=True),
    )


def downgrade():
    op.drop_column('jurisdiction_tax_data', 'millage_confidence')
