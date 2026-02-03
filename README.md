# REPS Hours Tracker

A modern, professional Real Estate Professional Status (REPS) hours tracking application built with React, TypeScript, and Tailwind CSS.

## Features

### Core Functionality
- **Chat-Like Hours Entry**: Intuitive, conversational interface for logging hours with minimal typing
- **Comprehensive Tracking**: Track hours by date, category, property, and type (material/non-material)
- **Advanced Filtering**: Filter entries by date range, category, property, and type
- **Search**: Full-text search across descriptions
- **Edit & Delete**: Modify or remove existing entries
- **Data Persistence**: All data stored locally in browser localStorage

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
- Fully responsive design (desktop, tablet, mobile)
- Intuitive navigation
- Visual feedback for all actions
- Loading states and error handling
- Toast notifications

## Technology Stack

- **Frontend Framework**: React 18
- **Language**: TypeScript
- **Styling**: Tailwind CSS v3
- **Build Tool**: Vite
- **Charts**: Recharts
- **Icons**: Lucide React
- **State Management**: React Context API + Hooks
- **Data Persistence**: localStorage

## Getting Started

### Prerequisites

- Node.js 16+ and npm installed on your machine

### Installation

1. Navigate to the project directory:
```bash
cd reps-tracker
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
http://localhost:5173
```

### Build for Production

To create a production build:
```bash
npm run build
```

The built files will be in the `dist` directory.

To preview the production build:
```bash
npm run preview
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
2. Follow the chat-like interface:
   - **Step 1**: Select a property
   - **Step 2**: Select a category
   - **Step 3**: Enter time (use quick buttons or custom input) and date
   - **Step 4**: Choose type (Material or Non-Material)
   - **Step 5**: Add optional description and review summary
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

### Managing Categories and Properties

1. Go to Settings
2. **For Categories**:
   - Add new categories with custom colors
   - Edit existing category names or colors
   - Delete unused categories (can't delete if used in entries)
3. **For Properties**:
   - Add new properties with optional addresses
   - Edit property information
   - Delete unused properties (can't delete if used in entries)

## Project Structure

```
reps-tracker/
├── src/
│   ├── components/
│   │   ├── Dashboard/         # Dashboard and analytics components
│   │   ├── HoursEntry/        # Chat-like entry form
│   │   ├── HoursList/         # List view with filtering
│   │   ├── Layout/            # Header, navigation, layout
│   │   ├── Settings/          # Category and property management
│   │   └── UI/                # Reusable UI components
│   ├── context/               # React Context for state management
│   ├── hooks/                 # Custom React hooks
│   ├── types/                 # TypeScript type definitions
│   ├── utils/                 # Utility functions
│   ├── App.tsx                # Main application component
│   ├── main.tsx               # Application entry point
│   └── index.css              # Global styles
├── public/                    # Static assets
├── index.html                 # HTML template
├── package.json               # Dependencies and scripts
├── tsconfig.json              # TypeScript configuration
├── tailwind.config.js         # Tailwind CSS configuration
├── vite.config.ts             # Vite configuration
└── README.md                  # This file
```

## Features in Detail

### Chat-Like Entry Interface

The hours entry form uses a conversational, step-by-step approach:
- Visual progress indicator
- Quick-select buttons for common values
- Auto-focus on next field
- Summary before submission
- Success animation

### Data Model

**Hours Entry**:
- Date, hours, minutes
- Category and property references
- Type (material/non-material)
- Description
- Timestamps (created/updated)

**Category**:
- Name and color
- Timestamp

**Property**:
- Name and optional address
- Timestamp

### Validation

All forms include comprehensive validation:
- Required field checks
- Format validation (dates, numbers)
- Range validation (hours 0-24, minutes 0-59)
- Duplicate name checks
- In-use checks before deletion

### Data Persistence

All data is automatically saved to browser localStorage:
- Changes persist across page refreshes
- No backend required
- Data stays on your device

### Export Format

CSV exports include all entry details:
- Date, hours, minutes, duration
- Category name, property name
- Type (Material/Non-Material)
- Description

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

## Support

For issues, questions, or suggestions, please create an issue in the project repository.

---

Built with ❤️ for real estate professionals tracking their REPS hours.
