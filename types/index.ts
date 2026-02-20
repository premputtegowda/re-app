// Auth types
export interface User {
  id: string;
  email: string;
  name: string;
  picture_url: string | null;
  is_admin: boolean;
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
  type: 'material' | 'non-material';
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
  monthHours: number;
  weekHours: number;
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

// Form types
export interface HoursEntryFormData {
  date: string;
  hours: number;
  minutes: number;
  category: string;
  property: string;
  description: string;
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
export type ViewMode = 'dashboard' | 'list' | 'entry' | 'settings' | 'cashOnCash';

// Toast/Notification types
export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
  duration?: number;
}

// Cash on Cash types
export type CoCScenarioType = 'base' | 'bull' | 'bear';
export type CoCPropertyType = 'sfr' | 'mfr';

export interface CoCCostItem {
  id: string;
  description: string;
  amount: number;
}

export interface CoCUnitMixEntry {
  id: string;
  type: string;      // e.g. "Studio", "1 Bed / 1 Bath"
  count: number;
  rentMonthly: number;
}

export interface CoCAcquisition {
  propertyAddress: string;
  propertyType: CoCPropertyType;
  units: number;
  unitMix: CoCUnitMixEntry[];   // when non-empty, overrides units + grossRentMonthly
  purchasePrice: number;
  arv: number;
  downPaymentPct: number;
  closingCostsPct: number;
  points: number;                       // discount/origination points; 1 point = 1% of loan
  hardCostItems: CoCCostItem[];         // direct construction: labor, materials, permits
  softCostItems: CoCCostItem[];         // indirect: design, legal, financing fees, inspections
  opportunityCostItems: CoCCostItem[];  // lost revenue, carry costs during renovation
  renovationMonths: number;             // context: how long the renovation takes
  interestRate: number;
  loanTermYears: number;
  ioPeriodMonths: number;
  stabilizedMonth: number;
  projectionYears: number;
}

export interface CoCOperations {
  grossRentMonthly: number;
  vacancyRatePct: number;
  opexPct: number;
  propertyMgmtPct: number;
  annualRentGrowthPct: number;
}

export interface CoCRefinance {
  enabled: boolean;
  refiYear: number;
  newLTV: number;
  newInterestRate: number;
  newLoanTermYears: number;
}

export interface CoCScenario {
  id: string;
  name: string;
  scenarioType: CoCScenarioType;
  acquisition: CoCAcquisition;
  operations: CoCOperations;
  refinance: CoCRefinance;
  createdAt: string;
  updatedAt: string;
}

export interface CoCYearlyProjection {
  year: number;
  grossRent: number;
  effectiveRent: number;
  opex: number;
  noi: number;
  debtService: number;
  cashOutProceeds: number;
  cashFlow: number;
  coCReturn: number;
  loanBalance: number;
  equityValue: number;
  cumulativeCashFlow: number;
}

export interface CoCResult {
  // Cost basis breakdown
  downPayment: number;
  closingCosts: number;
  pointsCost: number;
  hardCostItems: CoCCostItem[];
  hardCosts: number;
  softCostItems: CoCCostItem[];
  softCosts: number;
  opportunityCostItems: CoCCostItem[];
  lostOpportunityCost: number;
  totalInvested: number;
  // Loan
  initialLoanAmount: number;
  // Projections & KPIs
  yearlyProjections: CoCYearlyProjection[];
  irr: number | null;
  equityMultiple: number;
  avgCoCReturn: number;
  peakCoCReturn: number;
  totalCashFlow: number;
}
