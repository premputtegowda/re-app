"""
Run from backend/ directory:
    python scripts/send_report.py
"""
import asyncio
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app.services.scheduler import send_weekly_reports


async def main():
    print("Sending weekly reports...")
    result = await send_weekly_reports()
    print(f"Done: {result}")


if __name__ == "__main__":
    asyncio.run(main())
