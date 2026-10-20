import type {
  Account,
  Category,
  TransactionQuery,
  TransactionRecord,
} from "@/domain/models";
import { groupTransactionsByDay } from "@/features/transactions/list/sections";
import {
  MASKED_AMOUNT,
  MAX_WIDGET_ROWS,
} from "@/features/widgets/kinds/shared";
import type { WidgetKindDefinition } from "@/features/widgets/kinds/types";
import type { WidgetAppearance } from "@/features/widgets/settings";
import type {
  SnapshotGroup,
  SnapshotInput,
  SnapshotRow,
  WidgetSnapshotEntry,
} from "@/features/widgets/snapshot";
import { dateFormat, parseLocalDate } from "@/utils/date";
import { formatMoney } from "@/utils/money";
import { amountTone } from "@/utils/labels";

export interface TransactionsWidgetConfig extends WidgetAppearance {
  kind: "transactions";
  /** `null` means every account. */
  accountId: string | null;
}

function buildRow(
  transaction: TransactionRecord,
  accounts: ReadonlyMap<string, Account>,
  categories: ReadonlyMap<string, Category>,
  input: Pick<SnapshotInput, "t" | "locale">,
  hideAmounts: boolean,
): SnapshotRow {
  const { t, locale } = input;
  const isTransfer = transaction.kind === "transfer";
  const isIncome = transaction.kind === "income";
  const category = transaction.categoryId
    ? categories.get(transaction.categoryId)
    : undefined;
  const accountName = (id: string | null) =>
    (id ? accounts.get(id)?.name : undefined) || t("Unknown account");
  // The same fallbacks the transaction list shows.
  const title =
    transaction.title.trim() ||
    category?.name ||
    t(isTransfer ? "Transfer" : "Uncategorized");
  const detail = isTransfer
    ? `${accountName(transaction.accountId)} → ${accountName(transaction.destinationAccountId)}`
    : accountName(transaction.accountId);
  // Signed like the list: expenses negative, income positive, transfers unsigned.
  const signed =
    isIncome || isTransfer ? transaction.amountMinor : -transaction.amountMinor;
  return {
    id: transaction.id,
    title,
    detail,
    amount: hideAmounts
      ? MASKED_AMOUNT
      : formatMoney(signed, transaction.currency, locale, {
          sign: !isTransfer,
        }),
    tone: isTransfer ? "neutral" : amountTone(signed),
  };
}

function buildTransactions(
  config: TransactionsWidgetConfig,
  input: SnapshotInput,
  hideAmounts: boolean,
): NonNullable<WidgetSnapshotEntry["transactions"]> {
  const { source, t, locale, today } = input;
  const accounts = new Map(source.accounts.map((a) => [a.id, a]));
  const categories = new Map(source.categories.map((c) => [c.id, c]));
  // A deleted or archived account falls back to all accounts.
  const filter = config.accountId ? accounts.get(config.accountId) : undefined;
  const account =
    filter && !filter.archived && !filter.deletedAt ? filter : null;
  const scope: TransactionQuery = account ? { accountIds: [account.id] } : {};

  const upcoming = source.queryTransactions({
    ...scope,
    statuses: ["upcoming"],
    sort: "oldest",
    limit: MAX_WIDGET_ROWS,
  });
  const room = MAX_WIDGET_ROWS - upcoming.length;
  const posted =
    room > 0
      ? source.queryTransactions({
          ...scope,
          statuses: ["posted"],
          sort: "newest",
          limit: room,
        })
      : [];

  const row = (transaction: TransactionRecord) =>
    buildRow(transaction, accounts, categories, input, hideAmounts);
  const groups: SnapshotGroup[] = [];
  if (upcoming.length)
    groups.push({ heading: t("Upcoming"), rows: upcoming.map(row) });

  // Date headings are the list's own: weekday, short month and day, and the year once it differs.
  const sameYear = (date: string) => date.slice(0, 4) === today.slice(0, 4);
  for (const day of groupTransactionsByDay(posted.slice(0, room))) {
    groups.push({
      heading: dateFormat(
        locale,
        sameYear(day.title)
          ? { weekday: "long", month: "short", day: "numeric" }
          : {
              weekday: "short",
              month: "short",
              day: "numeric",
              year: "numeric",
            },
      ).format(parseLocalDate(day.title)),
      rows: day.data.map(row),
    });
  }
  return { title: account ? account.name : t("Transactions"), groups };
}

export const transactionsKind: WidgetKindDefinition<TransactionsWidgetConfig> =
  {
    kind: "transactions",
    defaults: { accountId: null },
    normalize: (raw) => ({
      accountId:
        typeof raw.accountId === "string" && raw.accountId.length > 0
          ? raw.accountId
          : null,
    }),
    build: (config, input, hideAmounts) => ({
      transactions: buildTransactions(config, input, hideAmounts),
    }),
  };
