import type {
  AccountType,
  CategoryKind,
  PeriodDefinition,
  RecurrenceUnit,
  TransactionKind,
  TransactionStatus,
} from '@/domain/models';

export type ImportSourceId = 'cashew';

export interface ImportSourceInfo {
  id: ImportSourceId;
  name: string;
  description: string;
  /** An existing AppIcon name. */
  icon: string;
  /** Shown on the file-picker button, e.g. "Cashew backup". */
  fileHint: string;
  /** Lowercase, no dot. */
  fileExtensions: string[];
  imports: string[];
  notImported: string[];
  caveats: string[];
}

export type ImportErrorCode = 'not-sqlite' | 'not-cashew' | 'unsupported' | 'corrupt' | 'reconciliation-failed';

export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode, message: string) {
    super(message);
    this.name = 'ImportError';
    this.code = code;
  }
}

export type RawValue = string | number | null;
export type RawRow = Record<string, RawValue>;

export interface CashewRawData {
  /** SQLite header `user_version` (Cashew schema version). */
  userVersion: number;
  /** IANA zone if the backup's app_settings records one, otherwise null. */
  detectedTimeZone: string | null;
  /** Every table in the file, rows keyed by column name. */
  tables: Record<string, RawRow[]>;
}

export interface ImportWarning {
  code: string;
  /** User-facing English sentence, no trailing details that vary per record. */
  message: string;
  /** Number of source records affected; 0 when not countable. */
  count: number;
}

export interface ImportCounts {
  accounts: number;
  categories: number;
  tags: number;
  transactions: number;
  recurringRules: number;
  budgets: number;
}

export interface BalanceCheck {
  accountExternalId: string;
  name: string;
  currency: string;
  /** Sum of the source's posted (paid) amounts for this wallet, in minor units. */
  sourceBalanceMinor: number;
  /** Signed sum of the bundle's posted transactions for this account, in minor units. */
  importedBalanceMinor: number;
}

export interface ImportReport {
  counts: ImportCounts;
  warnings: ImportWarning[];
  balanceChecks: BalanceCheck[];
}

export interface BundleAccount {
  externalId: string;
  name: string;
  type: AccountType;
  currency: string;
  openingBalanceMinor: number;
  icon: string;
  color: string;
  archived: boolean;
}

export interface BundleCategory {
  externalId: string;
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
  parentExternalId: string | null;
  archived: boolean;
}

export interface BundleTag {
  externalId: string;
  name: string;
  color: string;
}

export interface BundleTransaction {
  externalId: string;
  kind: TransactionKind;
  status: TransactionStatus;
  title: string;
  note: string;
  localDate: string;
  accountExternalId: string;
  destinationAccountExternalId: string | null;
  categoryExternalId: string | null;
  tagExternalIds: string[];
  /** Positive minor units of the source account's currency. */
  amountMinor: number;
  /** Transfers only: positive minor units of the destination account's currency. */
  destinationAmountMinor: number | null;
  /** History row that belongs to a recurring series (link only; no occurrence key). */
  recurringRuleExternalId: string | null;
}

export interface BundleRecurringRule {
  externalId: string;
  kind: 'expense' | 'income';
  title: string;
  note: string;
  accountExternalId: string;
  categoryExternalId: string | null;
  tagExternalIds: string[];
  amountMinor: number;
  currency: string;
  unit: RecurrenceUnit;
  interval: number;
  /** Always equal to nextDueDate (history stays as plain posted transactions). */
  startDate: string;
  endDate: string | null;
  nextDueDate: string;
  /** Always false: imported schedules are reviewed, never auto-posted. */
  autoPost: boolean;
  active: boolean;
}

export interface BundleBudget {
  externalId: string;
  name: string;
  icon: string;
  color: string;
  limitMinor: number;
  period: PeriodDefinition;
  accountExternalIds: string[];
  /** Explicit expense categories; [] means "all". */
  categoryExternalIds: string[];
  tagExternalIds: string[];
  categoryLimits: { categoryExternalId: string; limitMinor: number }[];
  archived: boolean;
}

export interface ImportBundle {
  source: ImportSourceId;
  /** IANA zone actually used to turn timestamps into local dates. */
  timeZone: string;
  timeZoneSource: 'backup' | 'device';
  accounts: BundleAccount[];
  categories: BundleCategory[];
  tags: BundleTag[];
  transactions: BundleTransaction[];
  recurringRules: BundleRecurringRule[];
  budgets: BundleBudget[];
  report: ImportReport;
}

export interface ParseOptions {
  /** Zone to use when the backup does not record one (the device zone). */
  fallbackTimeZone: string;
  /** Qashy base currency, used for wallets with no currency and for budget limits. */
  fallbackCurrency: string;
}

export type ImportMode = 'merge' | 'replace';

export interface ExternalImportOutcome {
  committed: boolean;
  created: ImportCounts;
  /** Existing vault entities matched by name (and kind/currency) instead of being created again. */
  reused: { accounts: number; categories: number; tags: number };
  /** Transactions skipped because the vault already has them (same derived id or same duplicate key). */
  duplicateTransactions: number;
  /** replace mode only: live entities that will be (were) soft-deleted. All zero in merge mode. */
  replaced: ImportCounts & { goals: number };
  /** Anything that would make the whole import invalid, e.g. a missing exchange rate. Commit refuses if non-empty. */
  rejected: { externalId: string; reason: string }[];
  /** New entities whose name was suffixed to stay unique. */
  renamed: { kind: 'account' | 'category' | 'tag'; from: string; to: string }[];
}
