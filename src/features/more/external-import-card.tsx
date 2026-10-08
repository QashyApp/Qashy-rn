import * as DocumentPicker from "expo-document-picker";
import { File as ExpoFile } from "expo-file-system";
import { useRouter } from "expo-router";
import { useRef, useState } from "react";
import { View, type ColorValue } from "react-native";

import { ActionButton } from "@/components/ui/action-button";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { MotionPressable } from "@/components/ui/motion";
import type { RatePair } from "@/data/exchange-rates/rate-service";
import { IMPORT_SOURCES } from "@/data/import/sources";
import { parseExternalBackup } from "@/data/import/parse";
import {
  ImportError,
  type ExternalImportOutcome,
  type ImportBundle,
  type ImportCounts,
  type ImportMode,
  type ImportSourceId,
  type ImportSourceInfo,
} from "@/data/import/types";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { exchangeRateService } from "@/providers/exchange-rate-provider";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { confirmDestructive, errorMessage, showError } from "@/utils/confirm";
import { MAX_BACKUP_IMPORT_BYTES, assertFileSize } from "@/utils/file-size";
import { hapticSelection, hapticSuccess } from "@/utils/haptics";
import { formatMoney } from "@/utils/money";

const COUNT_LABELS: {
  key: keyof ImportCounts;
  label: string;
  singular: string;
  plural: string;
}[] = [
  {
    key: "accounts",
    label: "Accounts",
    singular: "account",
    plural: "accounts",
  },
  {
    key: "categories",
    label: "Categories",
    singular: "category",
    plural: "categories",
  },
  { key: "tags", label: "Tags", singular: "tag", plural: "tags" },
  {
    key: "transactions",
    label: "Transactions",
    singular: "transaction",
    plural: "transactions",
  },
  {
    key: "recurringRules",
    label: "Recurring schedules",
    singular: "recurring schedule",
    plural: "recurring schedules",
  },
  { key: "budgets", label: "Budgets", singular: "budget", plural: "budgets" },
];

const MODES: {
  id: ImportMode;
  title: string;
  description: string;
  icon: string;
}[] = [
  {
    id: "merge",
    title: "Add to my current data",
    description:
      "Keeps everything you have. Matching accounts, categories and tags are reused.",
    icon: "tray",
  },
  {
    id: "replace",
    title: "Delete my current data and import this backup",
    description:
      "Permanently deletes your current accounts, transactions, budgets and goals first, then adds the backup. Not available on a device that syncs.",
    icon: "arrow.clockwise",
  },
];

/** "3 transactions, 2 categories and 1 account" from the non-zero counts; null when everything is zero. */
function describeCounts(
  counts: ImportCounts & { goals?: number },
): string | null {
  const parts = COUNT_LABELS.filter((item) => counts[item.key] > 0).map(
    (item) =>
      `${counts[item.key]} ${counts[item.key] === 1 ? item.singular : item.plural}`,
  );
  if (counts.goals)
    parts.push(`${counts.goals} ${counts.goals === 1 ? "goal" : "goals"}`);
  if (!parts.length) return null;
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

function totalOf(counts: ImportCounts) {
  return (
    counts.accounts +
    counts.categories +
    counts.tags +
    counts.transactions +
    counts.recurringRules +
    counts.budgets
  );
}

function fileExtension(name: string) {
  const dot = name.lastIndexOf(".");
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

/**
 * A large selectable row for a radio group: a source app, or an import mode. Selected reads as
 * pushed in with the accent fill and a filled radio mark; the mark is drawn (icon plus fill),
 * never colour alone. Tapping a selected row does nothing, as a radio should.
 */
function OptionRow({
  title,
  description,
  icon,
  selected,
  disabled = false,
  onPress,
}: {
  title: string;
  description: string;
  icon: string;
  selected: boolean;
  disabled?: boolean;
  onPress: () => void;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { t } = useLocalization();
  const foreground = selected ? theme.onAccentContainer : theme.text;
  return (
    <MotionPressable
      accessibilityLabel={`${t(title)}, ${t(description)}`}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      aria-checked={selected}
      active={selected}
      disabled={disabled}
      onPress={() => {
        if (selected) return;
        hapticSelection();
        onPress();
      }}
      pressedScale={0.985}
      hoverScale={1.01}
      style={({ pressed }) => [
        {
          minHeight: 64,
          flexDirection: "row",
          alignItems: "center",
          gap: space.md,
          padding: space.md + 2,
          borderRadius: radius.tile,
          borderCurve: "continuous",
          opacity: disabled ? 0.45 : pressed ? 0.8 : 1,
        },
        selected
          ? materialStyle(theme, "selected")
          : materialStyle(theme, "control"),
      ]}
    >
      <AppIcon
        name={icon}
        color={selected ? theme.onAccentContainer : theme.textMuted}
        size={22}
      />
      <View style={{ flex: 1, gap: space.xxs }}>
        <AppText variant="label" style={{ color: foreground }}>
          {title}
        </AppText>
        <AppText
          variant="caption"
          muted={!selected}
          style={selected ? { color: theme.onAccentContainer } : undefined}
        >
          {description}
        </AppText>
      </View>
      <View
        style={{
          width: 22,
          height: 22,
          borderRadius: radius.pill,
          alignItems: "center",
          justifyContent: "center",
          borderWidth: 2,
          borderColor: selected ? theme.onAccentContainer : theme.border,
          backgroundColor: selected ? theme.accent : "transparent",
        }}
      >
        {selected ? (
          <AppIcon name="checkmark" color={theme.onAccent} size={13} />
        ) : null}
      </View>
    </MotionPressable>
  );
}

function BulletList({
  items,
  icon,
  color,
}: {
  items: string[];
  icon: string;
  color: ColorValue;
}) {
  const { space } = useQashyTheme();
  return (
    <View style={{ gap: space.sm }}>
      {items.map((item) => (
        <View
          key={item}
          style={{
            flexDirection: "row",
            alignItems: "flex-start",
            gap: space.sm,
          }}
        >
          <View style={{ paddingTop: space.xxs }}>
            <AppIcon name={icon} color={color} size={16} />
          </View>
          <AppText variant="caption" style={{ flex: 1 }}>
            {item}
          </AppText>
        </View>
      ))}
    </View>
  );
}

function InfoSection({
  title,
  items,
  icon,
  tone,
}: {
  title: string;
  items: string[];
  icon: string;
  tone: "positive" | "negative" | "muted";
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  if (!items.length) return null;
  const color =
    tone === "positive"
      ? theme.positive
      : tone === "negative"
        ? theme.negative
        : theme.textMuted;
  return (
    <View accessibilityLabel={title} role="group" style={{ gap: space.sm }}>
      <AppText variant="label">{title}</AppText>
      <BulletList items={items} icon={icon} color={color} />
    </View>
  );
}

function StatTile({
  value,
  label,
  tone,
}: {
  value: number;
  label: string;
  tone: "accent" | "muted" | "negative";
}) {
  const theme = useQashyTheme();
  const { radius } = theme;
  return (
    <View
      style={{
        flex: 1,
        minWidth: 100,
        padding: 14,
        borderRadius: radius.card,
        backgroundColor:
          tone === "accent" ? theme.accentContainer : theme.surfaceMuted,
      }}
    >
      <AppText
        literal
        figure
        variant="headline"
        style={{
          color:
            tone === "accent"
              ? theme.accentText
              : tone === "negative" && value
                ? theme.negative
                : theme.text,
        }}
      >
        {String(value)}
      </AppText>
      <AppText variant="caption" muted>
        {label}
      </AppText>
    </View>
  );
}

function CountRow({ label, value }: { label: string; value: number }) {
  const { space } = useQashyTheme();
  return (
    <View
      style={{
        minHeight: 32,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: space.md,
      }}
    >
      <AppText variant="caption" style={{ flex: 1 }}>
        {label}
      </AppText>
      <AppText literal figure variant="label">
        {String(value)}
      </AppText>
    </View>
  );
}

function CountList({
  title,
  counts,
  extra,
}: {
  title: string;
  counts: ImportCounts & { goals?: number };
  extra?: boolean;
}) {
  const { space } = useQashyTheme();
  const rows = COUNT_LABELS.filter((item) => counts[item.key] > 0);
  const goals = extra ? (counts.goals ?? 0) : 0;
  if (!rows.length && !goals) return null;
  return (
    <View accessibilityLabel={title} role="group" style={{ gap: space.xxs }}>
      <AppText variant="label">{title}</AppText>
      {rows.map((item) => (
        <CountRow key={item.key} label={item.label} value={counts[item.key]} />
      ))}
      {goals ? <CountRow label="Goals" value={goals} /> : null}
    </View>
  );
}

function PreviewSummary({
  bundle,
  outcome,
  mode,
}: {
  bundle: ImportBundle;
  outcome: ExternalImportOutcome;
  mode: ImportMode;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { t, locale } = useLocalization();
  const router = useRouter();
  const existing =
    outcome.duplicateTransactions +
    outcome.reused.accounts +
    outcome.reused.categories +
    outcome.reused.tags;
  const reasons = new Map<string, number>();
  for (const item of outcome.rejected)
    reasons.set(item.reason, (reasons.get(item.reason) ?? 0) + 1);
  const reasonList = [...reasons.entries()];
  const replacedAny =
    mode === "replace" &&
    outcome.rejected.length === 0 &&
    (totalOf(outcome.replaced) > 0 || outcome.replaced.goals > 0);
  const { warnings, balanceChecks } = bundle.report;

  return (
    <View style={{ gap: space.md }}>
      <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
        <StatTile
          value={totalOf(outcome.created)}
          label="To add"
          tone="accent"
        />
        <StatTile value={existing} label="Already in Qashy" tone="muted" />
        <StatTile
          value={outcome.rejected.length}
          label="Blocked"
          tone="negative"
        />
      </View>

      <CountList title="Will be added" counts={outcome.created} />

      {replacedAny ? (
        <Card variant="inset" style={{ gap: space.sm }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <AppIcon
              name="exclamationmark.triangle"
              color={theme.negative}
              size={18}
            />
            <AppText variant="label" style={{ color: theme.negative, flex: 1 }}>
              Your current data will be permanently deleted
            </AppText>
          </View>
          <CountList title="Will be deleted" counts={outcome.replaced} extra />
        </Card>
      ) : null}

      {balanceChecks.length ? (
        <View
          accessibilityLabel={t("Balances checked")}
          role="group"
          style={{ gap: space.xs }}
        >
          <AppText variant="label">Balances checked</AppText>
          {balanceChecks.map((check) => {
            const matches =
              check.sourceBalanceMinor === check.importedBalanceMinor;
            return (
              <View
                key={check.accountExternalId}
                style={{
                  minHeight: 32,
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.sm,
                }}
              >
                <AppText literal variant="caption" style={{ flex: 1 }}>
                  {check.name}
                </AppText>
                <AppText literal figure variant="label">
                  {formatMoney(
                    check.importedBalanceMinor,
                    check.currency,
                    locale,
                  )}
                </AppText>
                <AppIcon
                  name={
                    matches ? "checkmark.circle" : "exclamationmark.triangle"
                  }
                  color={matches ? theme.positive : theme.negative}
                  size={18}
                />
              </View>
            );
          })}
        </View>
      ) : null}

      {warnings.length ? (
        <View
          accessibilityLabel={t("Notes about this backup")}
          role="group"
          style={{ gap: space.sm }}
        >
          <AppText variant="label">Notes about this backup</AppText>
          {warnings.map((warning) => (
            <View
              key={`${warning.code}:${warning.message}`}
              style={{
                flexDirection: "row",
                alignItems: "flex-start",
                gap: space.sm,
              }}
            >
              <View style={{ paddingTop: space.xxs }}>
                <AppIcon name="info.circle" color={theme.textMuted} size={16} />
              </View>
              <AppText variant="caption" style={{ flex: 1 }}>
                {warning.message}
              </AppText>
              {warning.count > 0 ? (
                <View
                  style={{
                    minWidth: 24,
                    paddingHorizontal: space.sm,
                    borderRadius: radius.pill,
                    backgroundColor: theme.surfaceMuted,
                    alignItems: "center",
                  }}
                >
                  <AppText literal figure variant="caption" muted>
                    {String(warning.count)}
                  </AppText>
                </View>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {outcome.renamed.length ? (
        <View style={{ gap: space.xs }}>
          {/* Built as one string so the pieces are announced together and the names
              (user data) are never run through the dictionary on their own. */}
          {outcome.renamed.slice(0, 5).map((item) => (
            <AppText
              key={`${item.kind}:${item.from}:${item.to}`}
              literal
              variant="caption"
              muted
            >
              {`${t("Renamed to avoid duplicates:")} ${item.from} → ${item.to}`}
            </AppText>
          ))}
          {outcome.renamed.length > 5 ? (
            <AppText literal variant="caption" muted>
              {t(`+${outcome.renamed.length - 5} more`)}
            </AppText>
          ) : null}
        </View>
      ) : null}

      {outcome.rejected.length ? (
        <Card variant="inset" style={{ gap: space.sm }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            <AppIcon
              name="exclamationmark.triangle"
              color={theme.negative}
              size={18}
            />
            <AppText variant="label" style={{ color: theme.negative, flex: 1 }}>
              Can’t import yet
            </AppText>
          </View>
          {reasonList.slice(0, 4).map(([reason, count]) => (
            <AppText key={reason} literal variant="caption">
              {count > 1 ? `${t(reason)} (×${count})` : t(reason)}
            </AppText>
          ))}
          {reasonList.length > 4 ? (
            <AppText literal variant="caption" muted>
              {t(`+${reasonList.length - 4} more`)}
            </AppText>
          ) : null}
          <AppText variant="caption" muted>
            Nothing can be imported until these are fixed. For missing exchange
            rates, turn on automatic rates or add manual rates in More →
            Exchange rates, then preview again.
          </AppText>
          <ActionButton
            title="Open exchange rates"
            icon="arrow.left.arrow.right"
            variant="secondary"
            onPress={() => router.push("/exchange-rates")}
          />
        </Card>
      ) : null}
    </View>
  );
}

function SourcePanel({
  source,
  busy,
  onChoose,
}: {
  source: ImportSourceInfo;
  busy: boolean;
  onChoose: () => void;
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  return (
    <View style={{ gap: space.md }}>
      <Card variant="inset" style={{ gap: space.lg }}>
        <InfoSection
          title="Will be imported"
          items={source.imports}
          icon="checkmark"
          tone="positive"
        />
        <InfoSection
          title="Will not be imported"
          items={source.notImported}
          icon="xmark"
          tone="negative"
        />
        <InfoSection
          title="Good to know"
          items={source.caveats}
          icon="info.circle"
          tone="muted"
        />
      </Card>
      <ActionButton
        title={`Choose ${source.fileHint} file`}
        icon="doc"
        variant="secondary"
        onPress={onChoose}
        disabled={busy}
      />
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space.sm }}
      >
        <AppIcon name="lock" color={theme.textMuted} size={14} />
        <AppText variant="caption" muted style={{ flex: 1 }}>
          The file is read on this device and never uploaded.
        </AppText>
      </View>
    </View>
  );
}

/**
 * The currency/date pairs an external bundle needs a rate for before its preview: each posted
 * row converts from its account's currency, and a transfer also from its destination account's.
 * Upcoming and skipped rows need no rate yet, and the base currency never does. Recurring
 * catch-up is not included; its occurrence dates are not derivable from the bundle alone.
 */
function externalImportRatePairs(
  bundle: ImportBundle,
  baseCurrency: string,
): RatePair[] {
  const base = baseCurrency.trim().toUpperCase();
  const currencyByAccount = new Map<string, string>(
    bundle.accounts.map((account): [string, string] => [
      account.externalId,
      account.currency.trim().toUpperCase(),
    ]),
  );
  const seen = new Set<string>();
  const pairs: RatePair[] = [];
  const add = (accountExternalId: string | null, localDate: string) => {
    const currency =
      accountExternalId === null
        ? undefined
        : currencyByAccount.get(accountExternalId);
    if (!currency || currency === base) return;
    const key = `${currency}|${localDate}`;
    if (seen.has(key)) return;
    seen.add(key);
    pairs.push({ currency, localDate });
  };
  for (const transaction of bundle.transactions) {
    if (transaction.status !== "posted") continue;
    add(transaction.accountExternalId, transaction.localDate);
    add(transaction.destinationAccountExternalId, transaction.localDate);
  }
  return pairs;
}

export function ExternalImportCard() {
  const { space } = useQashyTheme();
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const { t } = useLocalization();
  const [sourceId, setSourceId] = useState<ImportSourceId | null>(null);
  const [bundle, setBundle] = useState<ImportBundle | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [outcome, setOutcome] = useState<ExternalImportOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  // The in-flight guard. State lags a render behind a double tap, so each check reads this ref,
  // and `busy` only drives what is shown and disabled.
  const busyRef = useRef(false);
  const setBusyFlag = (value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  };
  // True while the replace confirmation is on screen, so the button can say what it is waiting on.
  const [confirming, setConfirming] = useState(false);
  const source = IMPORT_SOURCES.find((item) => item.id === sourceId) ?? null;

  const clearArmed = () => {
    // A replacement attempt must never leave the last file armed, or the next Import could
    // commit a different backup than the one the user just reviewed.
    setBundle(null);
    setOutcome(null);
  };

  const chooseFile = async () => {
    if (!source || busyRef.current) return;
    setBusyFlag(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: "*/*",
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      clearArmed();
      const asset = result.assets[0];
      if (!source.fileExtensions.includes(fileExtension(asset.name))) {
        showError(
          "Wrong file type",
          `This file does not look like a ${source.name} backup. Choose a ${source.fileHint} file.`,
        );
        return;
      }
      const nativeFile = asset.file ? null : new ExpoFile(asset.uri);
      assertFileSize(
        asset.size ?? asset.file?.size ?? nativeFile?.size,
        MAX_BACKUP_IMPORT_BYTES,
        "Backup file",
      );
      const bytes = asset.file
        ? new Uint8Array(await asset.file.arrayBuffer())
        : await nativeFile!.bytes();
      // Let the "reading" state paint before the synchronous parse blocks the thread.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const parsed = parseExternalBackup(source.id, bytes, {
        fallbackTimeZone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        fallbackCurrency: state.settings.baseCurrency,
      });
      setBundle(parsed);
    } catch (reason) {
      clearArmed();
      showError(
        "Couldn’t read backup",
        reason instanceof ImportError
          ? reason.message
          : errorMessage(reason, "Choose another backup file."),
      );
    } finally {
      setBusyFlag(false);
    }
  };

  const previewImport = async () => {
    if (!bundle || busyRef.current) return;
    setBusyFlag(true);
    try {
      // Best-effort, as in the CSV preview: fills in the automatic rates the posted rows need so
      // they are not reported missing. A no-op when auto-fetch is off, and it never throws; a
      // failed lookup falls through to the preview's own missing-rate report.
      await exchangeRateService.ensureRatesFor(
        externalImportRatePairs(bundle, state.settings.baseCurrency),
      );
      setOutcome(
        await repository.importExternalBundle(bundle, { mode }, false),
      );
    } catch (reason) {
      setOutcome(null);
      showError(
        "Couldn’t preview import",
        errorMessage(reason, "Try choosing the file again."),
      );
    } finally {
      setBusyFlag(false);
    }
  };

  const commit = async () => {
    if (!bundle || !outcome || busyRef.current || outcome.rejected.length)
      return;
    // Busy from before the dialog opens until the commit settles. The button stays disabled
    // while the confirmation is up, so a second tap cannot queue a second import behind it.
    setBusyFlag(true);
    try {
      if (mode === "replace") {
        const deleted = describeCounts(outcome.replaced);
        setConfirming(true);
        const confirmed = await confirmDestructive({
          title: "Delete your current data?",
          message: deleted
            ? `This permanently deletes ${deleted} you have now, then imports the backup. You can’t undo this.`
            : "This permanently deletes your current data, then imports the backup. You can’t undo this.",
          confirmLabel: "Delete and import",
        }).finally(() => setConfirming(false));
        if (!confirmed) return;
      }
      const result = await repository.importExternalBundle(
        bundle,
        { mode },
        true,
      );
      if (!result.committed) {
        setOutcome(result);
        showError(
          "Couldn’t import backup",
          "Nothing was imported. Fix the blocked items and preview again.",
        );
        return;
      }
      hapticSuccess();
      clearArmed();
      setMode("merge");
      showError(
        "Import complete",
        `Added ${describeCounts(result.created) ?? "nothing new"}.`,
      );
    } catch (reason) {
      showError(
        "Couldn’t import backup",
        errorMessage(reason, "Nothing was imported."),
      );
    } finally {
      setBusyFlag(false);
    }
  };

  return (
    <Card style={{ gap: 14 }}>
      <AppText variant="headline">Import from another app</AppText>
      <AppText muted>
        Bring your history over from a backup file. Everything is read on this
        device, and nothing is committed until after preview.
      </AppText>
      <View
        accessibilityLabel={t("Import from another app")}
        accessibilityRole="radiogroup"
        style={{ gap: space.sm }}
      >
        {IMPORT_SOURCES.map((item) => (
          <OptionRow
            key={item.id}
            title={item.name}
            description={item.description}
            icon={item.icon}
            selected={item.id === sourceId}
            disabled={busy}
            onPress={() => {
              setSourceId(item.id);
              clearArmed();
            }}
          />
        ))}
      </View>
      {source ? (
        <SourcePanel source={source} busy={busy} onChoose={chooseFile} />
      ) : null}
      {bundle ? (
        <View style={{ gap: space.md }}>
          <AppText variant="label">How should it be imported?</AppText>
          <View
            accessibilityLabel={t("How should it be imported?")}
            accessibilityRole="radiogroup"
            style={{ gap: space.sm }}
          >
            {MODES.map((item) => (
              <OptionRow
                key={item.id}
                title={item.title}
                description={item.description}
                icon={item.icon}
                selected={mode === item.id}
                disabled={busy}
                onPress={() => {
                  setMode(item.id);
                  setOutcome(null);
                }}
              />
            ))}
          </View>
          <AppText literal variant="caption" muted>
            {`${t("Dates use")} ${bundle.timeZone} (${t(bundle.timeZoneSource === "backup" ? "from the backup" : "this device’s timezone")}).`}
          </AppText>
          <ActionButton
            title={busy && !outcome ? "Checking…" : "Preview import"}
            icon="checkmark"
            onPress={previewImport}
            disabled={busy}
          />
        </View>
      ) : null}
      {bundle && outcome ? (
        <View style={{ gap: space.md, paddingTop: 6 }}>
          <PreviewSummary bundle={bundle} outcome={outcome} mode={mode} />
          <ActionButton
            title={
              confirming
                ? "Waiting for confirmation…"
                : busy
                  ? "Importing…"
                  : "Import"
            }
            icon="checkmark"
            size="large"
            onPress={commit}
            disabled={busy || confirming || outcome.rejected.length > 0}
          />
        </View>
      ) : null}
    </Card>
  );
}
