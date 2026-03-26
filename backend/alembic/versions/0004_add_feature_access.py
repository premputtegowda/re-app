"""Add features array to users

Revision ID: 0004
Revises: 0003
Create Date: 2026-03-23
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import ARRAY

revision = '0004'
down_revision = '0003'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'users',
        sa.Column(
            'features',
            ARRAY(sa.String()),
            nullable=False,
            server_default='{"reps"}',
        ),
    )


def downgrade():
    op.drop_column('users', 'features')
