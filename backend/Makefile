.PHONY: dev migrate

dev:
	source venv/bin/activate && alembic upgrade head && uvicorn app.main:app --reload

migrate:
	source venv/bin/activate && alembic upgrade head
