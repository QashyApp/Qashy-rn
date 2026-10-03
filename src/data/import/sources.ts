import type { ImportSourceId, ImportSourceInfo } from "./types";

export const IMPORT_SOURCES: readonly ImportSourceInfo[] = [
  {
    id: "cashew",
    name: "Cashew",
    description: "Import a full backup exported from the Cashew budgeting app.",
    icon: "tray",
    fileHint: "Cashew backup",
    fileExtensions: ["sql", "db", "sqlite"],
    imports: [
      "Accounts (Cashew wallets) with their currencies",
      "Categories and subcategories, with colours and matched icons",
      "Every expense, income and transfer between wallets, with notes and tags",
      "The paid, upcoming and skipped state of each transaction",
      "Subscriptions and repeating transactions, as recurring schedules that wait for your review",
      "Budgets: amount, period, wallets, included categories and per-category limits",
    ],
    notImported: [
      "Loans and credit/debt entries (money lent, borrowed or deposited)",
      "Objectives (savings goals)",
      'Budget transaction filters (for example "include income" or "added to another budget"), shared budgets and "added transactions only" budgets, which become ordinary budgets',
      "Associated titles (automatic category suggestions) and scanner templates",
      "Cashew app settings, widgets, cached exchange rates and cloud-sync history",
    ],
    caveats: [
      "Amounts are converted to exact minor units of each account’s currency. An amount with more decimals than its currency allows is rounded.",
      "Cashew backups do not record a timezone, so dates use this device’s timezone unless the backup states one. A transaction made near midnight in another timezone can land on the neighbouring day.",
      "Account balances are checked against the backup before anything is saved. If they do not match, nothing is imported.",
      "Accounts in a currency other than your base currency need exchange rates for their dates. Turn on automatic rates or add manual ones first, otherwise the import is blocked.",
      "A category used for both income and expenses is split into an income copy and an expense copy, and names that clash with an existing name get a suffix.",
      "Imported recurring schedules are set to review, not to post automatically.",
      "A subscription or repeating series only becomes a schedule if Cashew still has an upcoming entry for it. Series with no upcoming entry are treated as ended and only their past payments are imported.",
      "Importing the same backup twice is safe: items that are already in Qashy are recognised and skipped.",
      "Replace mode hides your current accounts, transactions, budgets and goals (they are soft-deleted, not erased) before adding the backup.",
      "Budget limits are read in your base currency.",
    ],
  },
];

export function getImportSource(id: ImportSourceId): ImportSourceInfo {
  const source = IMPORT_SOURCES.find((candidate) => candidate.id === id);
  if (!source) throw new Error(`Unknown import source: ${String(id)}`);
  return source;
}
