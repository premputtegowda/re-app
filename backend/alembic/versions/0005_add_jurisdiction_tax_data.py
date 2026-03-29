"""Add jurisdiction_tax_data table for property tax cache

Revision ID: 0005
Revises: 0004
Create Date: 2026-03-28
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'jurisdiction_tax_data',
        sa.Column('jurisdiction_key', sa.String(16), primary_key=True),
        sa.Column('fips', sa.String(5), nullable=False),
        sa.Column('district_code', sa.String(8), nullable=False),
        sa.Column('county_name', sa.String(100), nullable=False),
        sa.Column('state', sa.String(2), nullable=False),
        sa.Column('assessment_ratio', sa.Float, nullable=False),
        sa.Column('effective_millage', sa.Float, nullable=False),
        sa.Column('regime_type', sa.String(32), nullable=False),
        sa.Column('next_refresh_date', sa.Date, nullable=False),
        sa.Column('last_fetched_at', sa.DateTime, nullable=False),
        sa.Column('raw_gemini_response', JSONB, nullable=True),
    )
    op.create_index('ix_jurisdiction_tax_data_fips', 'jurisdiction_tax_data', ['fips'])


def downgrade():
    op.drop_index('ix_jurisdiction_tax_data_fips', table_name='jurisdiction_tax_data')
    op.drop_table('jurisdiction_tax_data')
