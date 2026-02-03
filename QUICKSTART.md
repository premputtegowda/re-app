# Quick Start Guide - REPS Hours Tracker

## Getting Started in 3 Steps

### 1. Start the Development Server

```bash
cd reps-tracker
npm run dev
```

The application will open automatically at http://localhost:5173

### 2. Set Up Your First Property

1. Click on **Settings** (gear icon) in the sidebar
2. Scroll to the **Properties** section
3. Click **Add Property**
4. Enter:
   - Property Name: "My First Property"
   - Address (optional): "123 Main Street"
5. Click **Add**

### 3. Log Your First Hours

1. Click **Add Hours** in the navigation
2. Follow the chat-like interface:
   - Select your property
   - Choose a category (defaults are provided)
   - Enter time using quick buttons or custom input
   - Select Material or Non-Material
   - Add optional description
3. Click **Save Entry**

**That's it!** You're now tracking your REPS hours!

---

## Key Features to Try

### Dashboard
- View total hours, monthly hours, and weekly hours
- See visual charts of your data
- Check recent entries

### View Hours
- See all your logged hours
- Filter by date range, category, property, or type
- Search descriptions
- Export to CSV
- Edit or delete entries

### Settings
- Add custom categories with colors
- Manage multiple properties
- Can't delete categories/properties in use

---

## Sample Workflow

**Week 1**: Log hours for property management tasks
1. Add Hours → Select Property → Category: "Property Management"
2. Enter 2 hours → Material → "Collected rent, inspected units"

**Week 2**: Track maintenance work
1. Add Hours → Select Property → Category: "Maintenance & Repairs"
2. Enter 3.5 hours → Material → "Fixed plumbing issues"

**Month End**: Review and export
1. Go to Dashboard → See monthly summary
2. View Hours → Filter by current month → Export CSV

---

## Tips

💡 **Quick Time Entry**: Use the preset buttons (0.5h, 1h, 2h, etc.) for faster logging

💡 **Bulk Filtering**: Select multiple categories or properties to compare hours

💡 **Regular Exports**: Export your data monthly as backup

💡 **Material vs Non-Material**:
- Material = hands-on work (inspections, repairs, tenant meetings)
- Non-Material = admin work (bookkeeping, planning)

---

## Troubleshooting

**Data not saving?**
- Check that localStorage is enabled
- Ensure you're not in private/incognito mode

**Need to reset everything?**
- Open browser console (F12)
- Run: `localStorage.clear()`
- Refresh page

---

## Next Steps

✅ Customize your categories in Settings
✅ Add all your properties
✅ Start logging hours consistently
✅ Review your dashboard weekly
✅ Export data monthly for records

Enjoy tracking your REPS hours! 🏡⏱️
