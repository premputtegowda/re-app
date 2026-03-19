"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-03-19
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect
from sqlalchemy.dialects import postgresql

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    conn = op.get_bind()

    # Create entry_type enum safely (no IF NOT EXISTS in Postgres for types)
    conn.execute(sa.text("""
        DO $$ BEGIN
            CREATE TYPE entry_type AS ENUM ('material', 'non-material');
        EXCEPTION WHEN duplicate_object THEN null;
        END $$;
    """))

    existing = inspect(conn).get_table_names()

    if "users" not in existing:
        op.create_table(
            "users",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("email", sa.String(255), nullable=False),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("picture_url", sa.String(500), nullable=True),
            sa.Column("google_id", sa.String(255), nullable=False),
            sa.Column("is_admin", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("has_complimentary_access", sa.Boolean(), nullable=False, server_default="false"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_users_email", "users", ["email"], unique=True)
        op.create_index("ix_users_google_id", "users", ["google_id"], unique=True)

    if "categories" not in existing:
        op.create_table(
            "categories",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(50), nullable=False),
            sa.Column("color", sa.String(7), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("user_id", "name", name="uq_category_user_name"),
        )
        op.create_index("ix_categories_user_id", "categories", ["user_id"])

    if "properties" not in existing:
        op.create_table(
            "properties",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("address", sa.String(200), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("user_id", "name", name="uq_property_user_name"),
        )
        op.create_index("ix_properties_user_id", "properties", ["user_id"])

    if "entries" not in existing:
        op.create_table(
            "entries",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("category_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("categories.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("property_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("properties.id", ondelete="RESTRICT"), nullable=False),
            sa.Column("date", sa.Date(), nullable=False),
            sa.Column("hours", sa.Integer(), nullable=False),
            sa.Column("minutes", sa.Integer(), nullable=False),
            sa.Column("total_minutes", sa.Integer(), nullable=False),
            sa.Column("type", sa.Enum("material", "non-material", name="entry_type", create_type=False), nullable=False),
            sa.Column("description", sa.Text(), nullable=False),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_entries_user_id", "entries", ["user_id"])
        op.create_index("ix_entries_date", "entries", ["date"])

    if "refresh_tokens" not in existing:
        op.create_table(
            "refresh_tokens",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("token_hash", sa.String(255), nullable=False, unique=True),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"])

    if "attachments" not in existing:
        op.create_table(
            "attachments",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("entry_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("entries.id", ondelete="CASCADE"), nullable=False),
            sa.Column("user_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("file_ref", sa.String(255), nullable=False),
            sa.Column("attachment_url", sa.String(1000), nullable=False),
            sa.Column("original_filename", sa.String(255), nullable=False),
            sa.Column("content_type", sa.String(100), nullable=False),
            sa.Column("file_size", sa.Integer(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_attachments_entry_id", "attachments", ["entry_id"])

    if "invitations" not in existing:
        op.create_table(
            "invitations",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("email", sa.String(255), nullable=False),
            sa.Column("token", sa.String(64), nullable=False, unique=True),
            sa.Column("invited_by_id", postgresql.UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("accepted_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_invitations_email", "invitations", ["email"])
        op.create_index("ix_invitations_token", "invitations", ["token"], unique=True)

    if "access_requests" not in existing:
        op.create_table(
            "access_requests",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column("email", sa.String(255), nullable=False),
            sa.Column("name", sa.String(100), nullable=False),
            sa.Column("picture_url", sa.String(500), nullable=True),
            sa.Column("status", sa.String(20), nullable=False, server_default="pending"),
            sa.Column("requested_at", sa.DateTime(), nullable=False),
            sa.Column("reviewed_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_access_requests_email", "access_requests", ["email"])


def downgrade() -> None:
    op.drop_table("access_requests")
    op.drop_table("invitations")
    op.drop_table("attachments")
    op.drop_table("refresh_tokens")
    op.drop_table("entries")
    op.drop_table("properties")
    op.drop_table("categories")
    op.drop_table("users")
    op.execute(sa.text("DROP TYPE IF EXISTS entry_type"))
