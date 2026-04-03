"""add calc_state_data to saved_deals

Revision ID: 0006
Revises: 0005
Create Date: 2026-04-03
"""
from alembic import op
import sqlalchemy as sa

revision = '0006'
down_revision = '0005'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('saved_deals', sa.Column('calc_state_data', sa.JSON(), nullable=True))


def downgrade():
    op.drop_column('saved_deals', 'calc_state_data')
