// Auth types
export interface User {
  id: string;
  email: string;
  name: string;
  picture_url: string | null;
  is_admin: boolean;
  has_complimentary_access: boolean;
  created_at: string;
  updated_at: string;
}

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

// Core data types
export interface HoursEntry {
  id: string;
  date: string; // ISO format (YYYY-MM-DD)
  hours: number;
  minutes: number;
  totalMinutes: number; // Calculated field: hours * 60 + minutes
  category: string; // category_id
  property: string; // property_id
  description: string;
  notes?: string; // Optional notes / evidence text
  type: 'material' | 'non-material';
  attachments?: Attachment[];
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}

export interface Category {
  id: string;
  name: string;
  color: string; // Hex color code
  createdAt: string;
}

export interface Property {
  id: string;
  name: string;
  address?: string;
  createdAt: string;
}

// Filter types
export interface HoursFilter {
  dateFrom?: string;
  dateTo?: string;
  categories?: string[];
  properties?: string[];
  types?: ('material' | 'non-material')[];
  searchQuery?: string;
}

// Summary/Analytics types
export interface SummaryData {
  totalHours: number;
  totalMinutes: number;
  monthMinutes: number;
  weekMinutes: number;
  monthHours: number;
  weekHours: number;
  materialMinutes: number;
  nonMaterialMinutes: number;
  materialHours: number;
  nonMaterialHours: number;
  entriesCount: number;
}

export interface CategorySummary {
  categoryId: string;
  categoryName: string;
  totalMinutes: number;
  totalHours: number;
  entryCount: number;
  color: string;
}

export interface PropertySummary {
  propertyId: string;
  propertyName: string;
  totalMinutes: number;
  totalHours: number;
  entryCount: number;
}

export interface MonthlyData {
  month: string; // Format: YYYY-MM
  totalMinutes: number;
  totalHours: number;
  entryCount: number;
}

// AI Classification types
export interface ClassificationResult {
  refined_title: string;
  refined_description: string;            // Purpose + Result
  evidence_note: string;                  // Evidence suggestion → pre-fills Notes field
  category_name: string | null;           // null when AI suggests a brand-new category
  suggested_new_category?: string | null; // set when category_name is null
  type: 'material' | 'non-material';
  audit_strength: 'high' | 'medium' | 'low';
  justification: string;
  audit_tip: string;
}

// Attachment stored in user's Google Drive or linked manually
export interface Attachment {
  id: string;
  entry_id: string;
  file_ref: string;
  attachment_url: string;
  original_filename: string;
  content_type: string;
  file_size: number;
  created_at: string;
}

// Form types
export interface HoursEntryFormData {
  date: string;
  hours: number;
  minutes: number;
  category: string;
  property: string;
  description: string;
  notes?: string;
  type: 'material' | 'non-material';
}

export interface CategoryFormData {
  name: string;
  color: string;
}

export interface PropertyFormData {
  name: string;
  address?: string;
}

// Validation types
export interface ValidationError {
  field: string;
  message: string;
}

export interface FormValidation {
  isValid: boolean;
  errors: ValidationError[];
}

// App state types
export interface AppState {
  entries: HoursEntry[];
  categories: Category[];
  properties: Property[];
  filter: HoursFilter;
  isLoading: boolean;
  error: string | null;
}

// Action types for state management
export type AppAction =
  | { type: 'ADD_ENTRY'; payload: HoursEntry }
  | { type: 'UPDATE_ENTRY'; payload: HoursEntry }
  | { type: 'DELETE_ENTRY'; payload: string }
  | { type: 'ADD_CATEGORY'; payload: Category }
  | { type: 'UPDATE_CATEGORY'; payload: Category }
  | { type: 'DELETE_CATEGORY'; payload: string }
  | { type: 'ADD_PROPERTY'; payload: Property }
  | { type: 'UPDATE_PROPERTY'; payload: Property }
  | { type: 'DELETE_PROPERTY'; payload: string }
  | { type: 'SET_FILTER'; payload: HoursFilter }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'LOAD_DATA'; payload: { entries: HoursEntry[]; categories: Category[]; properties: Property[] } };

// Sort types
export type SortField = 'date' | 'hours' | 'category' | 'property' | 'type';
export type SortOrder = 'asc' | 'desc';

export interface SortConfig {
  field: SortField;
  order: SortOrder;
}

// View types
export type ViewMode = 'dashboard' | 'list' | 'entry' | 'settings' | 'admin';

// Toast/Notification types
export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}
