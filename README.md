# REPS Hours Tracker

A modern, professional Real Estate Professional Status (REPS) hours tracking application built with Next.js 14, TypeScript, Zustand, and Tailwind CSS.

## Features

### Core Functionality
- **Chat-Like Hours Entry**: Intuitive, 5-step guided interface for logging hours with minimal typing
- **Comprehensive Tracking**: Track hours by date, category, property, and type (material/non-material)
- **Advanced Filtering**: Filter entries by date range, category, property, and type
- **Search**: Full-text search across descriptions
- **Edit & Delete**: Modify or remove existing entries
- **Data Persistence**: All data stored locally in browser localStorage with Zustand persist middleware

### Analytics & Reporting
- **Dashboard**: Overview with summary cards showing total hours, monthly hours, weekly hours, and top categories
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
- Intuitive navigation
- Visual feedback for all actions
- Toast notifications (Sonner)

## Technology Stack

- **Framework**: Next.js 14 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v3
- **State Management**: Zustand with persist middleware
- **Animations**: Framer Motion
- **Charts**: Recharts
- **Icons**: Lucide React
- **Notifications**: Sonner
- **Data Persistence**: localStorage (via Zustand persist)

## Getting Started

### Prerequisites

- Node.js 18+ and npm installed on your machine

### Installation

1. Clone the repository:
```bash
git clone https://github.com/premputtegowda/re-app.git
cd re-app
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open your browser and visit:
```
http://localhost:3000
```

### Build for Production

To create a production build:
```bash
npm run build
```

To start the production server:
```bash
npm run start
```

## Usage Guide

### First Time Setup

1. **Add Properties**:
   - Go to Settings (gear icon in sidebar)
   - Click "Add Property" under the Properties section
   - Enter property name and optional address
   - Click "Add"

2. **Add Categories** (Optional - default categories are provided):
   - In Settings, scroll to Categories section
   - Click "Add Category"
   - Enter category name and choose a color
   - Click "Add"

### Logging Hours

1. Click "Add Hours" in the navigation or on the dashboard
2. Follow the guided 5-step interface:
   - **Step 1**: Select a property
   - **Step 2**: Select a category
   - **Step 3**: Enter time (use quick buttons or custom input) and date
   - **Step 4**: Choose type (Material or Non-Material)
   - **Step 5**: Add description and review summary
3. Click "Save Entry"

### Viewing Hours

1. Click "View Hours" in the navigation
2. Use the filter bar to:
   - Search by description
   - Filter by date range
   - Filter by categories (multiple selection)
   - Filter by properties (multiple selection)
   - Filter by type
3. Click "Export" to download filtered results as CSV
4. Click edit or delete icons on any entry to modify it

### Dashboard

The dashboard provides an overview of your hours:
- **Summary Cards**: Total hours, monthly hours, weekly hours, top category
- **Material vs Non-Material**: Visual breakdown
- **Quick Stats**: Entry counts and averages
- **Charts**: Visual representations of your data
- **Recent Entries**: Quick view of latest logged hours

## Project Structure

```
reps-tracker/
├── app/
│   ├── globals.css          # Global styles with dark mode
│   ├── layout.tsx           # Root layout
│   └── page.tsx             # Main page component
├── components/
│   ├── Dashboard/           # Dashboard and analytics components
│   ├── HoursEntry/          # Chat-like entry form
│   ├── HoursList/           # List view with filtering
│   ├── Layout/              # Header, navigation, layout
│   ├── Settings/            # Category and property management
│   └── UI/                  # Reusable UI components
├── hooks/                   # Custom React hooks
├── lib/
│   └── store.ts             # Zustand store with persist
├── types/                   # TypeScript type definitions
├── utils/                   # Utility functions
├── next.config.js           # Next.js configuration
├── tailwind.config.js       # Tailwind CSS configuration
├── tsconfig.json            # TypeScript configuration
└── README.md                # This file
```

## Dark Mode

The app automatically adapts to your system's color scheme preference. Dark mode is enabled via Tailwind's `darkMode: 'media'` setting, which respects the `prefers-color-scheme` media query.

## Browser Support

- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Tips

1. **Quick Entry**: Use the quick-select buttons for common time values
2. **Filtering**: Combine multiple filters for precise results
3. **Backup**: Regularly export your data as CSV for backup
4. **Organization**: Use descriptive category names and colors for easy identification
5. **Mobile**: The app works great on mobile devices for on-the-go logging
6. **Dark Mode**: Switch your system to dark mode for a comfortable nighttime experience

## Troubleshooting

**Data not persisting?**
- Check that localStorage is enabled in your browser
- Ensure you're not in private/incognito mode

**Charts not displaying?**
- Make sure you have at least one hour entry
- Try refreshing the page

**Can't delete category/property?**
- Categories and properties can't be deleted if they're used in any entries
- Delete or reassign entries first

## License

This project is open source and available for personal and commercial use.

---

Built with Next.js, Zustand, Framer Motion, and Tailwind CSS.
