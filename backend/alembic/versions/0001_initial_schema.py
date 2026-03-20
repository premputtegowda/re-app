"""initial schema

Revision ID: 0001
Revises:
Create Date: 2026-03-19
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.execute(sa.text("""
        DO $$ BEGIN
            CREATE TYPE entry_type AS ENUM ('MATERIAL', 'NON_MATERIAL');
        EXCEPTION WHEN duplicate_object THEN null;
        END $$;
    """))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS users (
            id UUID PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            name VARCHAR(100) NOT NULL,
            picture_url VARCHAR(500),
            google_id VARCHAR(255) NOT NULL,
            is_admin BOOLEAN NOT NULL DEFAULT false,
            has_complimentary_access BOOLEAN NOT NULL DEFAULT false,
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL
        )
    """))
    op.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email ON users (email)"))
    op.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS ix_users_google_id ON users (google_id)"))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS categories (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(50) NOT NULL,
            color VARCHAR(7) NOT NULL,
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL,
            CONSTRAINT uq_category_user_name UNIQUE (user_id, name)
        )
    """))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_categories_user_id ON categories (user_id)"))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS properties (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name VARCHAR(100) NOT NULL,
            address VARCHAR(200),
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL,
            CONSTRAINT uq_property_user_name UNIQUE (user_id, name)
        )
    """))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_properties_user_id ON properties (user_id)"))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS entries (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            category_id UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
            property_id UUID NOT NULL REFERENCES properties(id) ON DELETE RESTRICT,
            date DATE NOT NULL,
            hours INTEGER NOT NULL,
            minutes INTEGER NOT NULL,
            total_minutes INTEGER NOT NULL,
            type entry_type NOT NULL,
            description TEXT NOT NULL,
            notes TEXT,
            created_at TIMESTAMP NOT NULL,
            updated_at TIMESTAMP NOT NULL
        )
    """))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_entries_user_id ON entries (user_id)"))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_entries_date ON entries (date)"))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS refresh_tokens (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash VARCHAR(255) NOT NULL UNIQUE,
            expires_at TIMESTAMP NOT NULL,
            created_at TIMESTAMP NOT NULL
        )
    """))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_refresh_tokens_user_id ON refresh_tokens (user_id)"))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS attachments (
            id UUID PRIMARY KEY,
            entry_id UUID NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            file_ref VARCHAR(255) NOT NULL,
            attachment_url VARCHAR(1000) NOT NULL,
            original_filename VARCHAR(255) NOT NULL,
            content_type VARCHAR(100) NOT NULL,
            file_size INTEGER NOT NULL,
            created_at TIMESTAMP NOT NULL
        )
    """))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_attachments_entry_id ON attachments (entry_id)"))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS invitations (
            id UUID PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            token VARCHAR(64) NOT NULL UNIQUE,
            invited_by_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMP NOT NULL,
            expires_at TIMESTAMP NOT NULL,
            accepted_at TIMESTAMP
        )
    """))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_invitations_email ON invitations (email)"))
    op.execute(sa.text("CREATE UNIQUE INDEX IF NOT EXISTS ix_invitations_token ON invitations (token)"))

    op.execute(sa.text("""
        CREATE TABLE IF NOT EXISTS access_requests (
            id UUID PRIMARY KEY,
            email VARCHAR(255) NOT NULL,
            name VARCHAR(100) NOT NULL,
            picture_url VARCHAR(500),
            status VARCHAR(20) NOT NULL DEFAULT 'pending',
            requested_at TIMESTAMP NOT NULL,
            reviewed_at TIMESTAMP
        )
    """))
    op.execute(sa.text("CREATE INDEX IF NOT EXISTS ix_access_requests_email ON access_requests (email)"))


def downgrade() -> None:
    op.execute(sa.text("DROP TABLE IF EXISTS access_requests"))
    op.execute(sa.text("DROP TABLE IF EXISTS invitations"))
    op.execute(sa.text("DROP TABLE IF EXISTS attachments"))
    op.execute(sa.text("DROP TABLE IF EXISTS refresh_tokens"))
    op.execute(sa.text("DROP TABLE IF EXISTS entries"))
    op.execute(sa.text("DROP TABLE IF EXISTS properties"))
    op.execute(sa.text("DROP TABLE IF EXISTS categories"))
    op.execute(sa.text("DROP TABLE IF EXISTS users"))
    op.execute(sa.text("DROP TYPE IF EXISTS entry_type"))
