"""
Bootstrap an admin user by email.

Usage:
    python -m scripts.bootstrap_admin <email>

The user must have logged in at least once before running this script.
"""
import asyncio
import sys

from sqlalchemy import select

from app.database import async_session_maker
from app.models import User


async def main(email: str) -> None:
    async with async_session_maker() as db:
        result = await db.execute(select(User).where(User.email == email))
        user = result.scalar_one_or_none()
        if not user:
            print(f"User '{email}' not found. They must log in to the app first.")
            sys.exit(1)
        user.is_admin = True
        await db.commit()
        print(f"Done. '{email}' is now an admin.")


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python -m scripts.bootstrap_admin <email>")
        sys.exit(1)
    asyncio.run(main(sys.argv[1]))
