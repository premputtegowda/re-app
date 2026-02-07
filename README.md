# REPS Hours Tracker

A modern, professional Real Estate Professional Status (REPS) hours tracking application built with Next.js 14, FastAPI, PostgreSQL, and Google OAuth.

## Features

### Core Functionality
- **Google OAuth Authentication**: Secure sign-in with Google
- **Chat-Like Hours Entry**: Intuitive, 5-step guided interface for logging hours
- **Comprehensive Tracking**: Track hours by date, category, property, and type (material/non-material)
- **Advanced Filtering**: Filter entries by date range, category, property, and type
- **Search**: Full-text search across descriptions
- **Edit & Delete**: Modify or remove existing entries
- **Cloud Sync**: All data synced to backend database

### Analytics & Reporting
- **Dashboard**: Overview with summary cards showing total hours, monthly hours, weekly hours
- **Visual Charts**:
  - Hours by Category (Bar Chart)
  - Hours by Property (Pie Chart)
  - Monthly Trends (Line Chart)
  - Material vs Non-Material Comparison (Pie Chart)
- **Export**: Download your data as CSV for external analysis

### Management
- **Dynamic Categories**: Add, edit, and delete categories with custom colors
- **Property Management**: Manage multiple properties with addresses
- **Settings Page**: Centralized location for managing categories and properties

### Design
- Modern, professional UI with a clean color scheme
- **Dark Mode**: Automatic dark mode based on system preferences
- **Smooth Animations**: Framer Motion animations throughout the app
- Fully responsive design (desktop, tablet, mobile)
- Toast notifications (Sonner)

## Technology Stack

### Frontend
- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v3
- **State Management**: Zustand
- **Animations**: Framer Motion
- **Charts**: Recharts
- **Icons**: Lucide React
- **Notifications**: Sonner

### Backend
- **Framework**: FastAPI (Python 3.11+)
- **Database**: PostgreSQL 15
- **ORM**: SQLAlchemy 2.0 (async)
- **Migrations**: Alembic
- **Authentication**: Google OAuth 2.0 + JWT

## Getting Started

### Prerequisites
- Node.js 18+
- Python 3.11+
- Docker (for PostgreSQL)
- Google Cloud Console project with OAuth 2.0 credentials

### 1. Clone the Repository
```bash
git clone https://github.com/premputtegowda/re-app.git
cd re-app
```

### 2. Setup Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select an existing one
3. Enable the Google+ API
4. Go to Credentials → Create Credentials → OAuth 2.0 Client ID
5. Configure the OAuth consent screen
6. Add authorized JavaScript origins: `http://localhost:3000`
7. Add authorized redirect URIs: `http://localhost:8000/api/auth/google/callback`
8. Copy the Client ID and Client Secret

### 3. Backend Setup

```bash
cd backend

# Start PostgreSQL
docker compose up db -d

# Create virtual environment
python3.11 -m venv venv
source venv/bin/activate

# Install dependencies
pip install -r requirements.txt

# Create .env file
cp .env.example .env
# Edit .env with your Google OAuth credentials

# Run migrations
alembic upgrade head

# Start the server
uvicorn app.main:app --reload
```

Backend runs at: http://localhost:8000
API docs at: http://localhost:8000/docs

### 4. Frontend Setup

```bash
# From project root
npm install

# Create .env.local file
cp .env.local.example .env.local
# Edit with your Google Client ID

# Start the development server
npm run dev
```

Frontend runs at: http://localhost:3000

## Environment Variables

### Frontend (`.env.local`)
```env
NEXT_PUBLIC_API_URL=http://localhost:8000
NEXT_PUBLIC_GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
```

### Backend (`backend/.env`)
```env
DEBUG=true
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/reps_tracker
JWT_SECRET_KEY=your-super-secret-key-change-in-production
GOOGLE_CLIENT_ID=your-google-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:8000/api/auth/google/callback
FRONTEND_URL=http://localhost:3000
```

## Usage Guide

### Getting Started

1. **Sign In**: Click "Sign in with Google" on the login page
2. **Add a Property**: Go to Settings and add your first property
3. **Log Hours**: Use the guided form to log your hours

### Logging Hours

1. Click "Add Hours" in the navigation
2. Follow the 5-step interface:
   - **Step 1**: Select a property
   - **Step 2**: Select a category
   - **Step 3**: Enter time and date
   - **Step 4**: Choose type (Material or Non-Material)
   - **Step 5**: Add description and save

### Viewing Hours

1. Click "View Hours" in the navigation
2. Use filters to find specific entries
3. Click edit or delete icons to modify entries

### Dashboard

View your analytics:
- Summary cards with totals
- Charts showing hours distribution
- Recent entries

## Project Structure

```
reps-tracker/
├── app/                      # Next.js App Router
├── components/
│   ├── Auth/                 # Login components
│   ├── Dashboard/            # Analytics views
│   ├── HoursEntry/           # Entry form
│   ├── HoursList/            # List with filters
│   ├── Layout/               # Header, navigation
│   ├── Settings/             # Management
│   └── UI/                   # Reusable components
├── lib/
│   ├── api.ts                # API client
│   ├── authStore.ts          # Auth state
│   └── store.ts              # App state
├── hooks/                    # Custom hooks
├── types/                    # TypeScript types
├── utils/                    # Utilities
└── backend/
    ├── app/
    │   ├── models/           # Database models
    │   ├── schemas/          # Pydantic schemas
    │   ├── routers/          # API endpoints
    │   ├── services/         # Business logic
    │   └── utils/            # Utilities
    ├── tests/                # Pytest tests
    └── alembic/              # Migrations
```

## API Endpoints

### Authentication
- `POST /api/auth/google/token` - Exchange Google credential for JWT
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout
- `GET /api/auth/me` - Get current user

### Categories
- `GET /api/categories` - List categories
- `POST /api/categories` - Create category
- `PUT /api/categories/{id}` - Update category
- `DELETE /api/categories/{id}` - Delete category

### Properties
- Same CRUD pattern as categories

### Entries
- `GET /api/entries` - List entries (with filters)
- `POST /api/entries` - Create entry
- `PUT /api/entries/{id}` - Update entry
- `DELETE /api/entries/{id}` - Delete entry

### Analytics
- `GET /api/analytics/summary` - Get summary stats
- `GET /api/analytics/by-category` - Hours by category
- `GET /api/analytics/by-property` - Hours by property
- `GET /api/analytics/monthly` - Monthly trends

## Testing

### Backend Tests
```bash
cd backend
source venv/bin/activate
pytest -v
```

## Troubleshooting

**Can't sign in with Google?**
- Check that your Google OAuth credentials are correctly configured
- Ensure the authorized origins and redirect URIs are set correctly
- Check browser console for errors

**Backend not connecting?**
- Ensure PostgreSQL is running: `docker compose up db -d`
- Check that `.env` has correct database URL
- Run migrations: `alembic upgrade head`

**Frontend not connecting to backend?**
- Ensure backend is running on port 8000
- Check `.env.local` has correct `NEXT_PUBLIC_API_URL`

## Future Plans

- Offline-first with IndexedDB
- Freemium model with Stripe
- Mobile app (React Native)
- Data export/import

## License

This project is open source and available for personal and commercial use.

---

Built with Next.js, FastAPI, PostgreSQL, and Google OAuth.
