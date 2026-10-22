/**
 * Import from another app, as a four-stage wizard: source → file → review → done.
 *
 * The previous layout stacked the source list, the caveat wall, the picker, the mode choice,
 * the preview and the commit in one card, which buried the Import action under every
 * diagnostic. Each stage now asks one question; the long reference copy is a disclosure; the
 * review puts the commit above the supporting detail.
 *
 * The safety rules are unchanged: a preview is still the only path to the commit, a replace
 * still asks for a destructive confirmation, and choosing a source or file disarms the previous
 * bundle so an Import can never commit something other than what was reviewed.
 */

import { router } from "expo-router";
import { useRef, useState } from "react";
import { AccessibilityInfo, View, type ColorValue } from "react-native";

import { ActionButton } from "@/components/ui/action-button";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { FormScreen } from "@/components/ui/form-screen";
import { MotionView } from "@/components/ui/motion";
import { OptionRow } from "@/components/ui/option-row";
import { ProgressBar } from "@/components/ui/progress-bar";
import { TextButton } from "@/components/ui/text-button";
import type { RatePair } from "@/data/exchange-rates/rate-service";
import { parseExternalBackup } from "@/data/import/parse";
import { IMPORT_SOURCES } from "@/data/import/sources";
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
  fileExtension,
  pickAsset,
  readAssetBytes,
} from "@/features/shared/pick-file";
import { clearWidgetData } from "@/features/widgets";
import { useLocalization } from "@/localization/localization";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import { exchangeRateService } from "@/providers/exchange-rate-provider";
import { useQashyTheme } from "@/theme/theme";
import { confirmDestructive, errorMessage, showError } from "@/utils/confirm";
import { MAX_BACKUP_IMPORT_BYTES } from "@/utils/file-size";
import { hapticSuccess } from "@/services/haptics";
import { formatMoney } from "@/utils/money";

type Stage = "source" | "file" | "review" | "done";

const STAGES: readonly Stage[] = ["source", "file", "review", "done"];

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

/**
 * The non-zero counts as translated bullet lines ("• 3 transactions"); null when everything is
 * zero. One line per kind, translated on its own, so no sentence has to join a list of
 * counts in every language.
 */
function describeCounts(
  counts: ImportCounts & { goals?: number },
  t: (message: string) => string,
): string | null {
  const items = COUNT_LABELS.filter((item) => counts[item.key] > 0).map(
    (item) =>
      `${counts[item.key]} ${counts[item.key] === 1 ? item.singular : item.plural}`,
  );
  if (counts.goals)
    items.push(`${counts.goals} ${counts.goals === 1 ? "goal" : "goals"}`);
  if (!items.length) return null;
  return items.map((item) => `• ${t(item)}`).join("\n");
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

/** The reference copy, collapsed behind a disclosure on the source step. */
function SourceDetails({ source }: { source: ImportSourceInfo }) {
  const { space } = useQashyTheme();
  return (
    <View style={{ gap: space.lg }}>
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

/**
 * The decision: what will be added, what a replace would delete, what is blocked, and the
 * commit. Supporting detail (balances, notes, renames) renders below this, so the Import
 * button never sits under it.
 */
function PreviewVerdict({
  outcome,
  mode,
  busy,
  confirming,
  onImport,
  onRetry,
}: {
  outcome: ExternalImportOutcome;
  mode: ImportMode;
  busy: boolean;
  confirming: boolean;
  onImport: () => void;
  onRetry: () => void;
}) {
  const theme = useQashyTheme();
  const { space } = theme;
  const { t } = useLocalization();
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
          <TextButton
            title="Preview again"
            icon="arrow.clockwise"
            tone="muted"
            onPress={onRetry}
            disabled={busy}
          />
        </Card>
      ) : null}

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
        onPress={onImport}
        disabled={busy || confirming || outcome.rejected.length > 0}
      />
    </View>
  );
}

/** Balances, notes and renames: useful context, never the thing the step is asking for. */
function PreviewDetails({
  bundle,
  outcome,
}: {
  bundle: ImportBundle;
  outcome: ExternalImportOutcome;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const { t, locale } = useLocalization();
  const { warnings, balanceChecks } = bundle.report;

  return (
    <View style={{ gap: space.md }}>
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

export function ExternalImportScreen() {
  const theme = useQashyTheme();
  const { space } = theme;
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const { t } = useLocalization();
  const [stage, setStage] = useState<Stage>("source");
  const [direction, setDirection] = useState<"forward" | "back">("forward");
  const [sourceId, setSourceId] = useState<ImportSourceId | null>(
    IMPORT_SOURCES[0]?.id ?? null,
  );
  const [bundle, setBundle] = useState<ImportBundle | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [outcome, setOutcome] = useState<ExternalImportOutcome | null>(null);
  const [result, setResult] = useState<ExternalImportOutcome | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
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

  const move = (next: Stage) => {
    setDirection(
      STAGES.indexOf(next) >= STAGES.indexOf(stage) ? "forward" : "back",
    );
    setStage(next);
  };

  const clearArmed = () => {
    // A failed or replaced file must never leave the last bundle armed, or the next Import
    // could commit a different backup than the one the user just reviewed.
    setBundle(null);
    setFileName(null);
    setOutcome(null);
    setMode("merge");
  };

  const chooseFile = async () => {
    if (!source || busyRef.current) return;
    setBusyFlag(true);
    try {
      const asset = await pickAsset();
      if (!asset) return;
      clearArmed();
      if (!source.fileExtensions.includes(fileExtension(asset.name))) {
        showError(
          "Wrong file type",
          `This file does not look like a ${source.name} backup. Choose a ${source.fileHint} file.`,
        );
        return;
      }
      const bytes = await readAssetBytes(
        asset,
        MAX_BACKUP_IMPORT_BYTES,
        "Backup file",
      );
      // Let the "reading" state paint before the synchronous parse blocks the thread.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const parsed = parseExternalBackup(source.id, bytes, {
        fallbackTimeZone:
          Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        fallbackCurrency: state.settings.baseCurrency,
      });
      setBundle(parsed);
      setFileName(asset.name);
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

  const previewImport = async (nextMode: ImportMode = mode) => {
    if (!bundle || busyRef.current) return false;
    setBusyFlag(true);
    try {
      // Best-effort, as in the CSV preview: fills in the automatic rates the posted rows need so
      // they are not reported missing. A no-op when auto-fetch is off, and it never throws; a
      // failed lookup falls through to the preview's own missing-rate report.
      await exchangeRateService.ensureRatesFor(
        externalImportRatePairs(bundle, state.settings.baseCurrency),
      );
      setOutcome(
        await repository.importExternalBundle(
          bundle,
          { mode: nextMode },
          false,
        ),
      );
      return true;
    } catch (reason) {
      setOutcome(null);
      showError(
        "Couldn’t preview import",
        errorMessage(reason, "Try choosing the file again."),
      );
      return false;
    } finally {
      setBusyFlag(false);
    }
  };

  const continueToReview = async () => {
    if (!bundle || busyRef.current) return;
    const previewed = await previewImport();
    if (previewed) move("review");
  };

  const changeMode = (next: ImportMode) => {
    if (busyRef.current || next === mode) return;
    // The mode changes what will be added and deleted, so the current preview is no longer the
    // thing the user would be confirming. Recompute it before the commit can be pressed.
    setMode(next);
    setOutcome(null);
    void previewImport(next);
  };

  const commit = async () => {
    if (!bundle || !outcome || busyRef.current || outcome.rejected.length)
      return;
    // Busy from before the dialog opens until the commit settles. The button stays disabled
    // while the confirmation is up, so a second tap cannot queue a second import behind it.
    setBusyFlag(true);
    try {
      if (mode === "replace") {
        const deleted = describeCounts(outcome.replaced, t);
        setConfirming(true);
        const confirmed = await confirmDestructive({
          title: "Delete your current data?",
          message: deleted
            ? `${t("This permanently deletes your current data, then imports the backup. You can’t undo this.")}\n\n${t("Will be deleted")}:\n${deleted}`
            : "This permanently deletes your current data, then imports the backup. You can’t undo this.",
          confirmLabel: "Delete and import",
        }).finally(() => setConfirming(false));
        if (!confirmed) return;
      }
      const imported = await repository.importExternalBundle(
        bundle,
        { mode },
        true,
      );
      if (!imported.committed) {
        setOutcome(imported);
        showError(
          "Couldn’t import backup",
          "Nothing was imported. Fix the blocked items and preview again.",
        );
        return;
      }
      // The replaced data is gone, so the widgets' stored snapshot is too; the repository emit
      // that follows rebuilds it from what was just imported.
      if (mode === "replace") void clearWidgetData();
      hapticSuccess();
      // The old flow announced the result in a dialog. The done stage replaces it, so announce
      // the heading explicitly rather than leaving assistive technology to notice the swap.
      if (typeof AccessibilityInfo?.announceForAccessibility === "function")
        AccessibilityInfo.announceForAccessibility(t("Import complete"));
      setResult(imported);
      clearArmed();
      move("done");
    } catch (reason) {
      showError(
        "Couldn’t import backup",
        errorMessage(reason, "Nothing was imported."),
      );
    } finally {
      setBusyFlag(false);
    }
  };

  const restart = () => {
    setResult(null);
    setDetailsOpen(false);
    clearArmed();
    move("source");
  };

  const leave = () => {
    if (router.canGoBack()) router.back();
    else router.replace("/csv");
  };

  const added = result ? describeCounts(result.created, t) : null;

  return (
    <FormScreen maxWidth={760} contentContainerStyle={{ gap: space.lg }}>
      <View style={{ gap: space.sm }}>
        <AppText
          literal
          variant="caption"
          muted
          style={{ textAlign: "center" }}
        >
          {t(`Step ${STAGES.indexOf(stage) + 1} of ${STAGES.length}`)}
        </AppText>
        <ProgressBar
          value={(STAGES.indexOf(stage) + 1) / STAGES.length}
          segments={STAGES.length}
          label={t("Import progress")}
        />
      </View>

      <MotionView
        key={`${stage}-${direction}`}
        variant={direction === "forward" ? "right" : "left"}
        exit
        animateLayout
        style={{ gap: space.lg }}
      >
        {stage === "source" && source ? (
          <>
            <AppText variant="title">Choose an app</AppText>
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
            <Card style={{ gap: space.sm }}>
              <TextButton
                title="What this includes"
                icon={detailsOpen ? "chevron.up" : "chevron.down"}
                tone="muted"
                accessibilityState={{ expanded: detailsOpen }}
                onPress={() => setDetailsOpen((open) => !open)}
              />
              {detailsOpen ? <SourceDetails source={source} /> : null}
            </Card>
            <ActionButton
              title="Continue"
              icon="arrow.right"
              size="large"
              onPress={() => move("file")}
            />
          </>
        ) : null}

        {stage === "file" && source ? (
          <>
            <AppText variant="title">Choose a backup file</AppText>
            <AppText muted>{source.description}</AppText>
            {bundle ? (
              <Card variant="inset" style={{ gap: space.sm }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.sm,
                  }}
                >
                  <AppIcon name="doc" color={theme.textMuted} size={18} />
                  <AppText literal variant="label" style={{ flex: 1 }}>
                    {fileName}
                  </AppText>
                </View>
                <AppText literal variant="caption" muted>
                  {`${t("Dates use")} ${bundle.timeZone} (${t(bundle.timeZoneSource === "backup" ? "from the backup" : "this device’s timezone")}).`}
                </AppText>
                <TextButton
                  title="Choose a different file"
                  icon="doc"
                  tone="muted"
                  onPress={chooseFile}
                  disabled={busy}
                />
              </Card>
            ) : (
              <ActionButton
                title={`Choose ${source.fileHint} file`}
                icon="doc"
                size="large"
                onPress={chooseFile}
                disabled={busy}
                busy={busy}
              />
            )}
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.sm,
              }}
            >
              <AppIcon name="lock" color={theme.textMuted} size={14} />
              <AppText variant="caption" muted style={{ flex: 1 }}>
                The file is read on this device and never uploaded.
              </AppText>
            </View>
            {bundle ? (
              <ActionButton
                title={busy ? "Checking…" : "Continue"}
                icon="arrow.right"
                size="large"
                onPress={continueToReview}
                disabled={busy}
                busy={busy}
              />
            ) : null}
            <TextButton
              title="Back"
              tone="muted"
              onPress={() => move("source")}
              disabled={busy}
            />
          </>
        ) : null}

        {stage === "review" && source ? (
          <>
            <AppText variant="title">Review import</AppText>
            <View style={{ gap: space.sm }}>
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
                    onPress={() => changeMode(item.id)}
                  />
                ))}
              </View>
              {bundle ? (
                <AppText literal variant="caption" muted>
                  {`${t("Dates use")} ${bundle.timeZone} (${t(bundle.timeZoneSource === "backup" ? "from the backup" : "this device’s timezone")}).`}
                </AppText>
              ) : null}
            </View>

            {bundle && outcome ? (
              <>
                <PreviewVerdict
                  outcome={outcome}
                  mode={mode}
                  busy={busy}
                  confirming={confirming}
                  onImport={commit}
                  onRetry={() => {
                    // Drop the stale result first: the verdict is no longer what is on screen
                    // while the fresh preview runs, and the Import button must not read as
                    // though a commit were already under way.
                    setOutcome(null);
                    void previewImport();
                  }}
                />
                <TextButton
                  title="Back"
                  tone="muted"
                  onPress={() => move("file")}
                  disabled={busy || confirming}
                />
                <PreviewDetails bundle={bundle} outcome={outcome} />
              </>
            ) : busy ? (
              <>
                <Card variant="inset">
                  <AppText muted>Checking…</AppText>
                </Card>
                <TextButton
                  title="Back"
                  tone="muted"
                  onPress={() => move("file")}
                  disabled
                />
              </>
            ) : (
              <>
                <ActionButton
                  title="Preview import"
                  icon="checkmark"
                  size="large"
                  onPress={() => void previewImport()}
                />
                <TextButton
                  title="Back"
                  tone="muted"
                  onPress={() => move("file")}
                />
              </>
            )}
          </>
        ) : null}

        {stage === "done" ? (
          <>
            <AppText variant="title">Import complete</AppText>
            <Card variant="inset" style={{ gap: space.sm }}>
              {added ? (
                <>
                  <AppText variant="label">Added to your data:</AppText>
                  <AppText literal variant="caption">
                    {added}
                  </AppText>
                </>
              ) : (
                <AppText muted>Added nothing new.</AppText>
              )}
            </Card>
            <ActionButton
              title="Done"
              icon="checkmark"
              size="large"
              onPress={leave}
            />
            <TextButton
              title="Import another backup"
              icon="arrow.clockwise"
              tone="muted"
              onPress={restart}
            />
          </>
        ) : null}
      </MotionView>
    </FormScreen>
  );
}
