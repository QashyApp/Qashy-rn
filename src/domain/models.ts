export type CurrencyCode = string;

export type ThemeMode = 'system' | 'light' | 'dark';
export type AccentSource = 'system' | 'preset' | 'custom';
export type AccountType = 'cash' | 'checking' | 'savings' | 'credit' | 'wallet';
export type CategoryKind = 'expense' | 'income';
export type TransactionKind = 'expense' | 'income' | 'transfer';
export type TransactionStatus = 'posted' | 'upcoming' | 'skipped';
export type GoalKind = 'saving' | 'spending';
export type PeriodUnit = 'day' | 'week' | 'month' | 'year' | 'custom';
export type RecurrenceUnit = 'day' | 'week' | 'month' | 'year';

export interface SyncEntity {
  id: string;
  revision: number;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface Money {
  minor: number;
  currency: CurrencyCode;
}

export interface AppSettings extends SyncEntity {
  onboardingComplete: boolean;
  locale: string;
  baseCurrency: CurrencyCode;
  /** Per device (`deviceLocal` in the sync registry). An id this device cannot resolve falls back to the default theme. */
  themeId: string;
  themeMode: ThemeMode;
  accentSource: AccentSource;
  accentHex: string;
  /** Per device (`deviceLocal`). Swipe sideways on Overview and Transactions to change month. Saves from before this existed read as off. */
  swipeBetweenMonths?: boolean;
}

export interface Account extends SyncEntity {
  name: string;
  type: AccountType;
  currency: CurrencyCode;
  openingBalanceMinor: number;
  icon: string;
  color: string;
  archived: boolean;
}

export interface Category extends SyncEntity {
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  parentId: string | null;
  archived: boolean;
}

export interface Tag extends SyncEntity {
  name: string;
  color: string;
}

/** A charge originally priced in a currency other than its account's. */
export interface ForeignAmount {
  /** Minor units of `currency`. */
  amountMinor: number;
  currency: CurrencyCode;
  /** Decimal string: 1 unit of `currency` = `exchangeRate` units of the account currency. */
  exchangeRate: string;
}

export type TransactionFeeKind = 'percent' | 'fixed';

export interface TransactionFee {
  kind: TransactionFeeKind;
  /** Decimal percentage string such as "2.5" for 'percent'; null for 'fixed'. */
  percent: string | null;
  /** The fee in account-currency minor units: the entered value for 'fixed', the computed snapshot for 'percent'. */
  amountMinor: number;
}

export interface ForeignAmountInput {
  amountMinor: number;
  currency: CurrencyCode;
  /** Omit to resolve from stored rates for the date. */
  exchangeRate?: string;
}

export type TransactionFeeInput =
  | { kind: 'percent'; percent: string }
  | { kind: 'fixed'; amountMinor: number };

export interface TransactionRecord extends SyncEntity {
  kind: TransactionKind;
  status: TransactionStatus;
  title: string;
  note: string;
  localDate: string;
  accountId: string;
  destinationAccountId: string | null;
  categoryId: string | null;
  tagIds: string[];
  /**
   * The TOTAL effect on the account, in account-currency minor units: the principal
   * (converted from `foreign` when set, otherwise entered directly) plus an expense's fee or
   * minus an income's fee. Balances, analytics, and budgets read this field alone and never
   * need to know a transaction carried a foreign price or a fee.
   */
  amountMinor: number;
  destinationAmountMinor: number | null;
  destinationBaseAmountMinor: number | null;
  currency: CurrencyCode;
  destinationCurrency: CurrencyCode | null;
  exchangeRate: string;
  baseAmountMinor: number;
  transferGroupId: string | null;
  recurringRuleId: string | null;
  occurrenceKey: string | null;
  /**
   * Optional because records saved before this field existed lack it entirely. Read a
   * missing (`undefined`) value the same as `null` — "no foreign amount was recorded" —
   * never as "unknown".
   */
  foreign?: ForeignAmount | null;
  /**
   * Optional because records saved before this field existed lack it entirely. Read a
   * missing (`undefined`) value the same as `null` — "no fee was recorded" — never as
   * "unknown".
   */
  fee?: TransactionFee | null;
}

export interface BudgetFilters {
  accountIds: string[];
  categoryIds: string[];
  tagIds: string[];
}

export interface PeriodDefinition {
  unit: PeriodUnit;
  interval: number;
  anchorDate: string;
  endDate: string | null;
}

export interface BudgetCategoryLimit {
  categoryId: string;
  limitMinor: number;
}

export interface Budget extends SyncEntity {
  name: string;
  icon: string;
  color: string;
  limitMinor: number;
  period: PeriodDefinition;
  rollover: boolean;
  filters: BudgetFilters;
  categoryLimits: BudgetCategoryLimit[];
  archived: boolean;
}

export interface BudgetPeriodSnapshot extends SyncEntity {
  budgetId: string;
  periodStart: string;
  periodEnd: string;
  limitMinor: number;
  rolloverMinor: number;
  filters: BudgetFilters;
  categoryLimits: BudgetCategoryLimit[];
}

/**
 * A one-time change to a single budget period's limit — money handed out, or a deliberate cut.
 *
 * Deliberately its own entity rather than a field on the snapshot: it is create-only, so two
 * devices adding one at the same moment both land instead of one overwriting the other, and it
 * is keyed by `date` rather than `periodStart`, so editing the budget's period definition
 * re-homes it to whichever window now contains that date instead of orphaning it.
 */
export interface BudgetAdjustment extends SyncEntity {
  budgetId: string;
  /** Local calendar date the adjustment applies to; it counts toward the period containing it. */
  date: string;
  /** Signed, non-zero, in base-currency minor units. */
  amountMinor: number;
  note: string;
}

export interface Goal extends SyncEntity {
  name: string;
  kind: GoalKind;
  icon: string;
  color: string;
  targetMinor: number;
  initialMinor: number;
  targetDate: string | null;
  linkedAccountId: string | null;
  linkedCategoryId: string | null;
  archived: boolean;
}

export interface GoalContribution extends SyncEntity {
  goalId: string;
  amountMinor: number;
  localDate: string;
  transactionId: string | null;
  note: string;
}

export interface RecurringTemplate {
  kind: Exclude<TransactionKind, 'transfer'>;
  title: string;
  note: string;
  accountId: string;
  categoryId: string | null;
  tagIds: string[];
  amountMinor: number;
  currency: CurrencyCode;
  /** When set, each occurrence is priced in this currency; a missing exchangeRate is resolved per occurrence date. */
  foreign?: ForeignAmountInput | null;
  fee?: TransactionFeeInput | null;
}

export interface RecurringRule extends SyncEntity {
  template: RecurringTemplate;
  unit: RecurrenceUnit;
  interval: number;
  startDate: string;
  endDate: string | null;
  nextDueDate: string;
  autoPost: boolean;
  active: boolean;
  /** True only when Qashy paused this rule because an account/category was archived. */
  pausedByDependency: boolean;
}

export interface ExchangeRate extends SyncEntity {
  fromCurrency: CurrencyCode;
  toCurrency: CurrencyCode;
  rate: string;
  effectiveDate: string;
}

export interface FinanceState {
  ready: boolean;
  settings: AppSettings;
  accounts: Account[];
  categories: Category[];
  tags: Tag[];
  transactions: TransactionRecord[];
  budgets: Budget[];
  budgetPeriods: BudgetPeriodSnapshot[];
  budgetAdjustments: BudgetAdjustment[];
  goals: Goal[];
  contributions: GoalContribution[];
  recurringRules: RecurringRule[];
  exchangeRates: ExchangeRate[];
}

export interface TransactionQuery {
  search?: string;
  accountIds?: string[];
  categoryIds?: string[];
  tagIds?: string[];
  kinds?: TransactionKind[];
  statuses?: TransactionStatus[];
  fromDate?: string;
  toDate?: string;
  minMinor?: number;
  maxMinor?: number;
  limit?: number;
  offset?: number;
  sort?: 'newest' | 'oldest' | 'amount-desc' | false;
}

export interface DashboardSummary {
  netWorthMinor: number;
  incomeMinor: number;
  expenseMinor: number;
  netFlowMinor: number;
  budgetLimitMinor: number;
  budgetSpentMinor: number;
  accountBalances: { account: Account; balanceMinor: number }[];
  categorySpend: { category: Category | null; amountMinor: number }[];
  recentTransactions: TransactionRecord[];
  upcomingTransactions: TransactionRecord[];
  dailySpend: { date: string; amountMinor: number }[];
  missingExchangeRates: { fromCurrency: CurrencyCode; toCurrency: CurrencyCode }[];
}

export interface BudgetStatus {
  budget: Budget;
  snapshot: BudgetPeriodSnapshot;
  spentMinor: number;
  /** Sum of this period's one-time adjustments; already included in `effectiveLimitMinor`. */
  adjustmentMinor: number;
  /** This period's live adjustments, newest first. */
  adjustments: BudgetAdjustment[];
  effectiveLimitMinor: number;
  categorySpend: { categoryId: string; amountMinor: number; limitMinor: number }[];
}

export interface CsvImportRow {
  rowNumber: number;
  date: string;
  type: TransactionKind;
  title: string;
  amount: string;
  currency: string;
  account: string;
  category: string;
  tags: string;
  note: string;
  exchangeRate: string;
  destinationAccount: string;
  destinationAmount: string;
  destinationBaseAmountMinor?: string;
  status?: TransactionStatus;
}

export interface ImportResult {
  validRows: CsvImportRow[];
  rejectedRows: { rowNumber: number; reason: string }[];
  duplicateRows: number[];
  warnings: string[];
  committedIds: string[];
}

/**
 * Every type a `records` row can hold, in a fixed order.
 *
 * The union is derived from this array rather than declared beside it, because the two
 * cannot then disagree. Anything that walks the whole vault — genesis, backup, restore —
 * has to enumerate the types at runtime, and a hand-maintained second copy that silently
 * omitted one would not fail to compile: it would export a backup missing a table.
 */
export const ENTITY_TYPES = [
  'settings',
  'accounts',
  'categories',
  'tags',
  'transactions',
  'budgets',
  'budgetPeriods',
  'budgetAdjustments',
  'goals',
  'contributions',
  'recurringRules',
  'exchangeRates',
] as const;

export type EntityType = (typeof ENTITY_TYPES)[number];

export type FinanceEntity =
  | AppSettings
  | Account
  | Category
  | Tag
  | TransactionRecord
  | Budget
  | BudgetPeriodSnapshot
  | BudgetAdjustment
  | Goal
  | GoalContribution
  | RecurringRule
  | ExchangeRate;
