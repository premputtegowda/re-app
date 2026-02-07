# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- **Dev server**: `npm run dev` (Next.js, port 3000)
- **Build**: `npm run build`
- **Start production**: `npm run start`
- **Lint**: `npm run lint` (ESLint with next/core-web-vitals)
- No test runner is configured.

## Architecture

This is a **client-only** Next.js 14 App Router application. There are no API routes or server-side data fetching — all data is stored in browser localStorage. Every component is marked `'use client'`.

### View Routing

`app/page.tsx` manages 4 views via `useState<ViewMode>`: `dashboard`, `list`, `entry`, `settings`. There is no file-based routing beyond the single page.

### State Management

Zustand store in `lib/store.ts` is the single source of truth. Key patterns:
- `useStore((s) => s.specificField)` — always use selective subscriptions to avoid unnecessary re-renders
- Persist middleware syncs `entries`, `categories`, `properties` to localStorage under key `'reps-storage'`
- All mutations (add/update/delete) trigger Sonner toast notifications
- `totalMinutes` is a calculated field set at entry creation/update from `hours` + `minutes`

### Data Model

- **HoursEntry**: Core entity with `date`, `hours`, `minutes`, `totalMinutes`, `category` (ID), `property` (ID), `type` ('material'|'non-material'), `description`
- **Category**: Has `name`, `color` (hex). Cannot be deleted if referenced by entries.
- **Property**: Has `name`, `address` (optional). Cannot be deleted if referenced by entries.

IDs are generated as `{prefix}-{timestamp}-{randomString}`.

### Key Directories

- `components/UI/` — Reusable primitives (Button, Card, Input, Select, Modal)
- `components/Dashboard/` — Analytics: SummaryCard, charts (Recharts)
- `components/HoursEntry/ChatLikeEntry.tsx` — 5-step guided form with AnimatePresence transitions
- `components/HoursList/` — Entry list with FilterBar, HoursListItem (edit/delete modals)
- `components/Settings/` — CategoryManager and PropertyManager (CRUD)
- `hooks/useHoursData.ts` — Memoized filtering, searching, and lookup hooks
- `utils/calculations.ts` — Summary aggregations, category/property/monthly breakdowns, `formatDuration()`
- `utils/validationUtils.ts` — Form validation returning `{ isValid, errors }` objects

### Styling

Tailwind CSS with custom color palette (`primary`=blue, `secondary`=green, `accent`=amber). Dark mode uses `darkMode: 'media'` (system preference, no manual toggle). All components have `dark:` variants. Path alias: `@/*` maps to project root.

### Animations

Framer Motion is used for page transitions, staggered list animations, modal enter/exit (AnimatePresence), and the multi-step entry form.

### Validation Constraints

- No future dates
- Time must be > 0 minutes
- Category names: 2-50 chars, unique
- Property names: 2-100 chars, unique
- Description: required, max 500 chars
