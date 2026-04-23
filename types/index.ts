// Auth types
export interface User {
  id: string;
  email: string;
  name: string;
  picture_url: string | null;
  is_admin: boolean;
  has_complimentary_access: boolean;
  features: string[];
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
  description: string;          // active description (used for audit)
  raw_description?: string;     // user's original text
  refined_description?: string; // AI-generated text
  ai_category_id?: string;      // AI-recommended category (never changes after first classify)
  ai_type?: string;             // AI-recommended type (never changes after first classify)
  notes?: string;
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
  raw_description?: string;
  refined_description?: string;
  ai_category_id?: string;
  ai_type?: string;
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
export type ViewMode = 'dashboard' | 'list' | 'entry' | 'settings' | 'admin' | 'dealAnalyzer';

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
  beds: number;
  baths: number;
  count: number;
  inPlaceRent: number;   // current avg rent
  preStabRent: number;   // rent during lease-up/renovation period
  rentMonthly: number;   // target (stabilized) rent
  unitsToRenovate?: number;
  leaseUpUnits?: number;
}

export interface CoCAcquisition {
  propertyAddress: string;
  propertyType: CoCPropertyType;
  units: number;
  sfrBeds: number;
  sfrBaths: number;
  sfrInPlaceRent: number;
  sfrPreStabRent: number;
  sfrTargetRent: number;
  unitMix: CoCUnitMixEntry[];   // when non-empty, overrides units + grossRentMonthly
  purchasePrice: number;
  arv: number;
  downPaymentPct: number;
  closingCostsPct: number;
  points: number;                       // discount/origination points; 1 point = 1% of loan
  additionalFeeItems: CoCCostItem[];    // other financing fees: origination, appraisal, title, etc.
  hardCostItems: CoCCostItem[];         // direct construction: labor, materials, permits
  softCostItems: CoCCostItem[];         // indirect: design, legal, financing fees, inspections
  opportunityCostItems: CoCCostItem[];  // lost revenue, carry costs during renovation
  renovationMonths: number;             // context: how long the renovation takes
  interestRate: number;
  loanTermYears: number;
  ioPeriodMonths: number;
  stabilizedMonth: number;
  projectionYears: number;
  exitCapRate: number;  // % — used when exitMethod = 'capRate'
  exitClosingCostPct: number;  // % of sale price; default 3
  exitMethod?: 'value' | 'capRate';  // 'value' = ARV or Market Value direct entry
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
  refiMarketValue: number;
  newLTV: number;
  newInterestRate: number;
  newLoanTermYears: number;
  refiCostPct: number; // closing costs as % of new loan amount
}

// Pro Forma types
export interface ProFormaItem {
  id: string;
  name: string;
  isPercentOfEGI: boolean;   // true for property mgmt (shows "X% EGI" instead of "$/mo")
  t12Value: number;           // $/mo, or % if isPercentOfEGI
  stabValue: number | null;   // null = inherited from t12
  stabilizedValue: number;
  growthPct: number;          // annual growth applied to stabilized value
}

export interface ProFormaData {
  grossRent: {
    t12: number;
    stab: number | null;
    stabilized: number;
    growthPct: number;
  };
  otherIncome: {
    t12: number;
    stab: number | null;
    stabilized: number;
    growthPct: number;
  };
  vacancyPct: {
    t12: number;
    stab: number | null;
    stabilized: number;
  };
  creditLossPct: {
    t12: number;
    stab: number | null;
    stabilized: number;
  };
  expenses: ProFormaItem[];
  lossToLeaseT12?: number;    // user-entered T12 loss to lease (annual $) — only for T12 column
  propertyTaxRatePct?: number; // derived: (stabilizedValue * 12) / purchasePrice — used in bisection, never shown to user
  /** 12-month histogram: units renewing per month (from reno/lease-up schedule). Sum = total units. */
  leaseAnniversaryDistribution?: number[];
  /**
   * Per-unit-type anniversary breakdown — preferred over `leaseAnniversaryDistribution`
   * when types have different target rents. Each entry has the type's monthly target
   * rent (per unit) and its own 12-month renewal histogram. The projector uses this
   * to compute Year 2+ Gross Lease Rent without blending types together.
   */
  leaseAnniversaryByType?: { targetRent: number; distribution: number[] }[];
  yearOverrides?: Record<number, {
    grossRent?: number;
    grossRentSystem?: boolean;       // true = set by rent schedule / calculator (not manual)
    yr1Blocked?: boolean;            // true = Year 1 override anchors the chain (Yr2+ rebase from it)
    grossRentGrowthPct?: number;     // growth rate FROM prev year TO this year
    otherIncome?: number;
    otherIncomeGrowthPct?: number;
    vacancyPct?: number;
    creditLossPct?: number;
    expenses?: Record<string, number>; // expenseId -> overridden value
    expenseGrowthPcts?: Record<string, number>; // expenseId -> growth rate
    // Tracks which fields were written by auto-cascade (not manually entered).
    // Cascade overwrites these; manual edits clear them.
    cascadedFields?: Partial<Record<'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct' | 'grossRentGrowthPct' | 'otherIncomeGrowthPct', true>>;
    cascadedExpenses?: Record<string, true>;        // expenseId -> cascaded
    cascadedExpenseGrowthPcts?: Record<string, true>; // expenseId -> cascaded
    toggleOffFields?: Partial<Record<'grossRent' | 'otherIncome' | 'vacancyPct' | 'creditLossPct', true>>; // fields last committed with pushToFuture=OFF
    toggleOffExpenses?: Record<string, true>;        // expenseId -> last committed with pushToFuture=OFF
    toggleOffGrowthPcts?: Partial<Record<'grossRentGrowthPct' | 'otherIncomeGrowthPct', true>>; // growth pct fields last committed with pushToFuture=OFF
    toggleOffExpenseGrowthPcts?: Record<string, true>; // expenseId growth pct -> last committed with pushToFuture=OFF
  }>;
}

export interface CoCScenario {
  id: string;
  name: string;
  scenarioType: CoCScenarioType;
  acquisition: CoCAcquisition;
  operations: CoCOperations;
  proForma?: ProFormaData;      // optional pro forma grid data
  refinance: CoCRefinance;
  createdAt: string;
  updatedAt: string;
}

export interface CoCYearlyProjection {
  year: number;
  marketRent: number;    // ideal rent: all units at market rate all year
  grossRent: number;     // actual collected rent (market - loss to lease)
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

export interface MCRangeEntry { min: number; mode: number; max: number; }

export interface CalcLocalRent {
  inPlace: number;
  target: number;
}

export interface CalcPersistedState {
  mode: 'renovate' | 'stabilize' | 'manual';
  totalDuration: number;
  unitsToStabilize: number[];
  perUnitMonths: number[];
  scheduleByType: number[][];
  manualDuration: number;
  manualPreStabRents: number[];
  localRents: CalcLocalRent[];
  leaseUpToStabilize: number[];
  leaseUpScheduleByType: number[][];
  distributionMethod?: 'weighted' | 'custom';
  // Form-level state persisted alongside calc state
  isValueAdd?: boolean | null;
  preStabMethod?: 'calculator' | 'manual' | null;
}

export interface SavedDeal {
  id: string;
  name: string;
  acquisition: CoCAcquisition;
  operations: CoCOperations;
  proForma: ProFormaData;
  refinance: CoCRefinance;
  results: Partial<Record<CoCScenarioType, CoCResult>>;
  mcRanges?: Record<string, MCRangeEntry>;
  /** ISO timestamp — when the user last confirmed the market uncertainty ranges.
   *  null means never reviewed; drives the "needs review" dirty flag on the wizard step. */
  mcRangesReviewedAt?: string | null;
  mcResults?: unknown; // SavedMCResults — typed as unknown to avoid circular import
  currentStep?: number;
  calcState?: CalcPersistedState;
  /** Per-step notes keyed by step index (0–4) */
  stepNotes?: Record<number, string>;
  savedAt: string;
  updatedAt: string;
}

export interface CoCResult {
  // Cost basis breakdown
  downPayment: number;
  closingCosts: number;
  pointsCost: number;
  additionalFeeItems: CoCCostItem[];
  additionalFees: number;
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
  // Exit summary
  terminalPropertyValue: number;
  exitClosingCosts: number;
  terminalEquity: number;
  irrCashFlows: number[];
}
