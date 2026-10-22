import { router } from "expo-router";
import { useRef, useState } from "react";
import { AccessibilityInfo } from "react-native";

import { parseExternalBackup } from "@/data/import/parse";
import { IMPORT_SOURCES } from "@/data/import/sources";
import {
  ImportError,
  type ExternalImportOutcome,
  type ImportBundle,
  type ImportMode,
  type ImportSourceId,
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
import { confirmDestructive, errorMessage, showError } from "@/utils/confirm";
import { MAX_BACKUP_IMPORT_BYTES } from "@/utils/file-size";
import { hapticSuccess } from "@/services/haptics";
import { describeCounts } from "@/features/more/external-import/import-summary-parts";
import {
  STAGES,
  Stage,
  externalImportRatePairs,
} from "@/features/more/external-import/external-import-model";

export function useExternalImport() {
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

  return {
    t,
    stage,
    direction,
    sourceId,
    setSourceId,
    bundle,
    fileName,
    mode,
    outcome,
    setOutcome,
    result,
    detailsOpen,
    setDetailsOpen,
    busy,
    confirming,
    source,
    move,
    clearArmed,
    chooseFile,
    previewImport,
    continueToReview,
    changeMode,
    commit,
    restart,
    leave,
  };
}
