"""Add saved_deals table for Deal Analyzer persistence

Revision ID: 0005
Revises: 0004
Create Date: 2026-03-29
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

revision = '0005'
down_revision = '0004'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'saved_deals',
        sa.Column('id', UUID(as_uuid=True), primary_key=True),
        sa.Column('user_id', UUID(as_uuid=True),
                  sa.ForeignKey('users.id', ondelete='CASCADE'),
                  nullable=False, index=True),
        sa.Column('name', sa.String(255), nullable=False),
        sa.Column('acquisition_data', sa.JSON(), nullable=False),
        sa.Column('operations_data', sa.JSON(), nullable=False),
        sa.Column('proforma_data', sa.JSON(), nullable=False),
        sa.Column('refinance_data', sa.JSON(), nullable=False),
        sa.Column('results_data', sa.JSON(), nullable=False),
        sa.Column('mc_ranges_data', sa.JSON(), nullable=True),
        sa.Column('mc_results_data', sa.JSON(), nullable=True),
        sa.Column('current_step', sa.Integer(), nullable=True),
        sa.Column('saved_at', sa.DateTime(), nullable=False,
                  server_default=sa.text('NOW()')),
        sa.Column('updated_at', sa.DateTime(), nullable=False,
                  server_default=sa.text('NOW()')),
    )


def downgrade():
    op.drop_table('saved_deals')
