"""add share columns to saved_deals

Revision ID: 0008
Revises: 0007
Create Date: 2026-04-11
"""
from alembic import op
import sqlalchemy as sa

revision = '0008'
down_revision = '0007'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('saved_deals', sa.Column('share_token', sa.String(64), nullable=True, unique=True))
    op.add_column('saved_deals', sa.Column('share_role', sa.String(32), nullable=True))
    op.add_column('saved_deals', sa.Column('share_expires_at', sa.DateTime(), nullable=True))
    op.create_index('ix_saved_deals_share_token', 'saved_deals', ['share_token'])


def downgrade():
    op.drop_index('ix_saved_deals_share_token', table_name='saved_deals')
    op.drop_column('saved_deals', 'share_expires_at')
    op.drop_column('saved_deals', 'share_role')
    op.drop_column('saved_deals', 'share_token')
