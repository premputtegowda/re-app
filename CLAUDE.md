# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Core Principles
**IMPORTANT**: Whenever you write code, it MUST follow SOLID design principles. Never write code that violates these principles. If you do, you will be asked to refactor it.

## Development Workflow
1. Before making any changes, create and checkout a feature branch named `feature-[brief-description]`
2. Write comprehensive tests for all new functionality
3. Compile code and run all tests before committing
4. Write detailed commit messages explaining the changes and rationale
5. Commit all changes to the feature branch

## Project Structure

```
reps-tracker/
├── app/                    # Next.js App Router
│   ├── page.tsx           # Main app entry (handles auth + views)
│   ├── layout.tsx         # Root layout
│   └── globals.css        # Tailwind imports
├── components/
│   ├── Auth/              # Google OAuth login components
│   ├── Dashboard/         # Analytics views
│   ├── HoursEntry/        # Hours entry form
│   ├── HoursList/         # Entry list with filters
│   ├── Layout/            # Header, Navigation
│   ├── Settings/          # Category/Property management
│   └── UI/                # Reusable primitives
├── lib/
│   ├── api.ts             # Backend API client
│   ├── authStore.ts       # Zustand auth state
│   └── store.ts           # Zustand app state
├── hooks/                 # Custom React hooks
├── utils/                 # Utility functions
├── types/                 # TypeScript types
└── backend/               # FastAPI backend
    ├── app/
    │   ├── models/        # SQLAlchemy models
    │   ├── schemas/       # Pydantic schemas
    │   ├── routers/       # API endpoints
    │   ├── services/      # Business logic
    │   └── utils/         # Utilities
    ├── tests/             # Pytest tests
    └── alembic/           # Database migrations
```

## Architecture Overview
- **Frontend**: Next.js 14 with TypeScript and Tailwind CSS
- **State Management**: Zustand for client + auth state
- **Backend**: FastAPI (Python 3.11+)
- **Database**: PostgreSQL 15
- **Authentication**: Google OAuth with JWT tokens

## Commands

### Frontend (from project root)
- `npm run dev` — Start dev server (port 3000)
- `npm run build` — Production build
- `npm run start` — Start production server
- `npm run lint` — Run ESLint

### Backend (from `backend/` directory)
- `docker compose up db -d` — Start PostgreSQL
- `source venv/bin/activate` — Activate virtual environment
- `pip install -r requirements.txt` — Install dependencies
- `alembic upgrade head` — Run database migrations
- `uvicorn app.main:app --reload` — Start dev server (port 8000)

### Testing (from `backend/` directory)
- `pytest` — Run all tests
- `pytest tests/test_auth.py` — Run single test file
- `pytest -k "test_google_login"` — Run tests matching pattern
- `pytest -v` — Verbose output
- `pytest --cov=app` — Run with coverage report

## Frontend Architecture

### View Routing
`app/page.tsx` manages authentication and 4 views via `useState<ViewMode>`: `dashboard`, `list`, `entry`, `settings`. Unauthenticated users see the login page.

### State Management

**Auth Store** (`lib/authStore.ts`):
- Manages user authentication state
- Handles Google OAuth login/logout
- Persists auth tokens to localStorage

**App Store** (`lib/store.ts`):
- Manages entries, categories, properties
- All CRUD operations call backend API
- Syncs data from backend on login
- Uses Zustand persist middleware

### API Client (`lib/api.ts`)
- Handles all backend communication
- Automatic token refresh on 401
- Token storage in localStorage

### Data Model

- **HoursEntry**: `id`, `date`, `hours`, `minutes`, `totalMinutes`, `category`, `property`, `type`, `description`
- **Category**: `id`, `name`, `color` (hex)
- **Property**: `id`, `name`, `address` (optional)

### Key Components

- `components/Auth/` — GoogleLoginButton, LoginPage
- `components/Dashboard/` — SummaryCard, charts (Recharts)
- `components/HoursEntry/ChatLikeEntry.tsx` — 5-step guided form
- `components/HoursList/` — Entry list with FilterBar
- `components/Settings/` — CategoryManager, PropertyManager

### Styling
Tailwind CSS with custom color palette (`primary`=blue, `secondary`=green, `accent`=amber). Dark mode uses `darkMode: 'media'` (system preference).

### Validation Constraints
- No future dates
- Time must be > 0 minutes
- Category names: 2-50 chars, unique
- Property names: 2-100 chars, unique
- Description: required, max 500 chars

## Backend Architecture

### Stack
- FastAPI with async/await
- SQLAlchemy 2.0 (async)
- PostgreSQL 15
- Alembic migrations
- Pydantic for validation

### Authentication
- Google OAuth 2.0 (popup flow)
- JWT access tokens (15 min expiry)
- Refresh tokens (7 days expiry)

### API Endpoints

**Auth** (`/api/auth/`):
- `POST /google/token` — Exchange Google credential for JWT
- `POST /refresh` — Refresh access token
- `POST /logout` — Invalidate refresh token
- `GET /me` — Get current user
- `DELETE /me` — Delete account

**Categories** (`/api/categories/`):
- `GET /` — List user's categories
- `POST /` — Create category
- `GET /{id}` — Get category
- `PUT /{id}` — Update category
- `DELETE /{id}` — Delete category

**Properties** (`/api/properties/`):
- Same CRUD pattern as categories

**Entries** (`/api/entries/`):
- `GET /` — List entries (with filters)
- `POST /` — Create entry
- `POST /bulk` — Bulk create (for migration)
- `GET /{id}` — Get entry
- `PUT /{id}` — Update entry
- `DELETE /{id}` — Delete entry

**Analytics** (`/api/analytics/`):
- `GET /summary` — Total/weekly/monthly stats
- `GET /by-category` — Hours by category
- `GET /by-property` — Hours by property
- `GET /monthly` — Monthly trends

### Test Structure
```
backend/tests/
├── conftest.py          # Fixtures: test DB, async client, mock user
├── test_auth.py         # Google OAuth, JWT token tests
├── test_categories.py   # Category CRUD tests
├── test_properties.py   # Property CRUD tests
├── test_entries.py      # Hours entry CRUD tests
└── test_analytics.py    # Analytics endpoint tests
```

### Key Fixtures (in `conftest.py`)
- `async_client` — AsyncClient with test database
- `test_db` — Fresh SQLite test database per function
- `auth_headers` — Valid JWT for test user
- `test_category`, `test_property` — Sample data

## Environment Variables

### Frontend (`.env.local`)
```
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id
```

### Backend (`.env`)
```
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/reps_tracker
JWT_SECRET_KEY=your-secret-key
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/google/callback
FRONTEND_URL=http://localhost:3000
```

## Future Plans
- Freemium model with Stripe integration
- Admin-granted complimentary access
- Offline-first with IndexedDB (Dexie.js)
- Background sync with conflict resolution
