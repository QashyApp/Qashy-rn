import type { AccountType, CategoryKind } from "@/domain/models";

/**
 * Human-facing labels and icons for internal enum values. Labels are English
 * dictionary keys: pass them through `t()` (or a `literal={false}` text) to
 * localize. Keep in sync with the onboarding account-type picker.
 */
export const ACCOUNT_TYPE_INFO: Record<
  AccountType,
  { label: string; icon: string }
> = {
  checking: { label: "Bank", icon: "building.columns" },
  cash: { label: "Cash", icon: "banknote" },
  savings: { label: "Savings", icon: "leaf" },
  credit: { label: "Credit card", icon: "creditcard" },
  wallet: { label: "Wallet", icon: "wallet" },
};

export const CATEGORY_KIND_LABEL: Record<CategoryKind, string> = {
  expense: "Expense",
  income: "Income",
};

export function accountTypeLabel(type: AccountType): string {
  return ACCOUNT_TYPE_INFO[type]?.label ?? type;
}

export function accountTypeIcon(type: AccountType): string {
  return ACCOUNT_TYPE_INFO[type]?.icon ?? "wallet";
}

export function categoryKindLabel(kind: CategoryKind): string {
  return CATEGORY_KIND_LABEL[kind] ?? kind;
}

/** Positive, negative and zero amounts need three distinct tones; zero is neutral. */
export function amountTone(minor: number): "positive" | "negative" | "neutral" {
  return minor > 0 ? "positive" : minor < 0 ? "negative" : "neutral";
}
