import { useMemo, useRef, useState } from "react";

import type { CsvImportRow, ImportResult } from "@/domain/models";
import {
  useFinanceRepository,
  useFinanceState,
} from "@/providers/finance-provider";
import {
  fileExtension,
  pickAsset,
  readAssetText,
} from "@/features/shared/pick-file";
import { requireHandedOff, saveFile } from "@/features/shared/save-file";
import { useLocalization } from "@/localization/localization";
import { errorMessage, showError } from "@/utils/confirm";
import { extractCsvRatePairs, parseCsvTable } from "@/utils/csv";
import {
  type CsvDateChoice,
  resolveCsvDateFormat,
} from "@/utils/csv-import-values";
import { todayLocal } from "@/utils/date";
import { hapticSuccess } from "@/services/haptics";
import { MAX_CSV_IMPORT_BYTES } from "@/utils/file-size";
import { exchangeRateService } from "@/providers/exchange-rate-provider";
import {
  CSV_EXTENSIONS,
  CSV_FIELDS,
  CsvField,
  inferMapping,
} from "@/features/more/csv/csv-model";
import {
  amountSignDecidesType,
  buildCsvRows,
  type CsvDateRejection,
} from "@/features/more/csv/csv-rows";

export function useCsvImport() {
  const repository = useFinanceRepository();
  const state = useFinanceState();
  const { t, locale } = useLocalization();
  const [sourceRows, setSourceRows] = useState<
    Record<string, string | number>[]
  >([]);
  const [headers, setHeaders] = useState<string[]>([]);
  // The header text as the file wrote it, parallel to `headers` (the normalized keys).
  const [headerLabels, setHeaderLabels] = useState<string[]>([]);
  const [dateChoice, setDateChoice] = useState<CsvDateChoice>("auto");
  const [mapping, setMapping] = useState<Record<CsvField, string>>(() =>
    inferMapping([]),
  );
  const [chosenAccountId, setDefaultAccountId] = useState(
    state.accounts.find((item) => !item.archived)?.id ?? "",
  );
  // The chosen account can be deleted while this screen is open (for example by a sync). Read
  // through the live list so a stale id falls back to the first available account, or none,
  // instead of keeping the account column optional for an account that no longer exists.
  const defaultAccountId =
    state.accounts.find((item) => item.id === chosenAccountId && !item.archived)
      ?.id ??
    state.accounts.find((item) => !item.archived)?.id ??
    "";
  const [defaultCategoryId, setDefaultCategoryId] = useState("");
  const [rows, setRows] = useState<CsvImportRow[]>([]);
  // Rows whose date the chosen format could not read. They are refused here, before the
  // repository, so their reason can name the format; kept to merge back into a commit's result.
  const dateRejections = useRef<CsvDateRejection[]>([]);
  const [preview, setPreview] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  // The in-flight guard. State lags a render behind a double tap, so every check reads this ref;
  // `busy` only drives what is shown and disabled.
  const busyRef = useRef(false);
  const setBusyFlag = (value: boolean) => {
    busyRef.current = value;
    setBusy(value);
  };
  // Bumped whenever the preview's inputs change (file, mapping, defaults). A preview still
  // awaiting its rate lookup then belongs to inputs the user has already replaced, so it must
  // not write its result back.
  const previewRequest = useRef(0);
  const invalidatePreview = () => {
    previewRequest.current += 1;
    setPreview(null);
  };
  const exportingRef = useRef(false);
  const [exporting, setExporting] = useState(false);
  // Type and currency fall back to expense and the row's account currency, and a chosen default
  // account covers an unmapped account column, so none of those block the preview.
  const isOptionalField = (field: (typeof CSV_FIELDS)[number]) =>
    field.optional || (field.key === "account" && Boolean(defaultAccountId));
  // What "Auto" resolves to for this file's date column. Shown in the picker and used to read it.
  const dateColumn = mapping.date;
  const detectedDateFormat = useMemo(
    () =>
      resolveCsvDateFormat(
        "auto",
        dateColumn
          ? sourceRows.map((row) => String(row[dateColumn] ?? ""))
          : [],
        locale,
      ),
    [sourceRows, dateColumn, locale],
  );
  const dateFormat = dateChoice === "auto" ? detectedDateFormat : dateChoice;
  // Whether the amounts' signs will decide each row's type, for the line under the mapping.
  const signDecidesType = useMemo(
    () => amountSignDecidesType(sourceRows, mapping),
    [sourceRows, mapping],
  );
  const missingRequiredFields = CSV_FIELDS.filter(
    (field) => !isOptionalField(field) && !mapping[field.key],
  );

  const pick = async () => {
    if (busyRef.current) return;
    setBusyFlag(true);
    try {
      const asset = await pickAsset();
      if (!asset) return;
      // A replacement attempt must never leave the last file armed. Otherwise a validation
      // error can make the next Import commit a different ledger than the user just reviewed.
      invalidatePreview();
      setSourceRows([]);
      setHeaders([]);
      setHeaderLabels([]);
      setDateChoice("auto");
      setMapping(inferMapping([]));
      setRows([]);
      dateRejections.current = [];
      if (!CSV_EXTENSIONS.includes(fileExtension(asset.name))) {
        showError("Wrong file type", "Choose a .csv file.");
        return;
      }
      const text = await readAssetText(asset, MAX_CSV_IMPORT_BYTES, "CSV file");
      const table = parseCsvTable(text);
      if (!table.rows.length) {
        showError(
          "No transactions found",
          "Choose a CSV with a header row and at least one data row.",
        );
        return;
      }
      setSourceRows(table.rows);
      setHeaders(table.headers);
      setHeaderLabels(table.headerLabels);
      setMapping(inferMapping(table.headers));
      // Malformed rows are skipped rather than aborting the file, and they must not disappear
      // quietly — the user needs to know what was left behind.
      if (table.rowErrors.length) {
        const lines = table.rowErrors.map((item) => item.lineNumber).join(", ");
        showError(
          `Skipped ${table.rowErrors.length} unreadable ${table.rowErrors.length === 1 ? "row" : "rows"}`,
          `The rest of the file was read. Check ${table.rowErrors.length === 1 ? "line" : "lines"} ${lines} for stray quotes.`,
          { quiet: true },
        );
      }
    } catch (reason) {
      showError(
        "Couldn’t read CSV",
        errorMessage(reason, "Choose another UTF-8 CSV file."),
      );
    } finally {
      setBusyFlag(false);
    }
  };

  const previewImport = async () => {
    if (busyRef.current || missingRequiredFields.length) return;
    setBusyFlag(true);
    try {
      await buildPreview();
    } catch (reason) {
      // `commit` has always reported its failures; this path silently did nothing,
      // so a throw from `importCsv` looked like a dead "Preview import" button.
      showError(
        "Couldn’t preview CSV",
        errorMessage(reason, "Check the column mapping and try again."),
      );
    } finally {
      setBusyFlag(false);
    }
  };

  const withDateRejections = (
    result: ImportResult,
    unreadable: CsvDateRejection[],
  ): ImportResult =>
    unreadable.length
      ? {
          ...result,
          rejectedRows: [...result.rejectedRows, ...unreadable].sort(
            (a, b) => a.rowNumber - b.rowNumber,
          ),
        }
      : result;

  const buildPreview = async () => {
    const defaultAccount =
      state.accounts.find((item) => item.id === defaultAccountId)?.name ?? "";
    const defaultCategory = state.categories.find(
      (item) => item.id === defaultCategoryId,
    );
    const { rows: parsed, dateRejections: unreadable } = buildCsvRows(
      sourceRows,
      mapping,
      dateFormat,
      {
        accountName: defaultAccount,
        baseCurrency: state.settings.baseCurrency,
        accountCurrencies: new Map(
          state.accounts.map((item) => [
            item.name.toLowerCase(),
            item.currency,
          ]),
        ),
        category: defaultCategory,
      },
    );
    // The request this preview answers. Read before the awaits below; any change to the file,
    // mapping, or defaults in the meantime bumps `previewRequest`, and this result is then dropped.
    const request = previewRequest.current;
    // Best-effort: fills in whatever automatic rates it can before validation runs, so a row
    // whose currency and date already have a fetched rate stops needing a manual one. A no-op
    // when auto-fetch is off, and it never throws — a failure here falls through to the same
    // "no rate for this date" rejection `importCsv` has always produced.
    // A foreign amount without its own rate needs its currency's rate for the row date too.
    const foreignPairs = extractCsvRatePairs(
      parsed
        .filter((row) => row.foreignAmount && row.foreignCurrency)
        .map((row) => ({
          date: row.date,
          currency: row.foreignCurrency ?? "",
          exchangeRate: row.foreignExchangeRate ?? "",
        })),
      state.settings.baseCurrency,
    );
    const seenPairs = new Set<string>();
    const ratePairs = [
      ...extractCsvRatePairs(parsed, state.settings.baseCurrency),
      ...foreignPairs,
    ].filter((pair) => {
      const key = `${pair.currency}|${pair.localDate}`;
      if (seenPairs.has(key)) return false;
      seenPairs.add(key);
      return true;
    });
    if (ratePairs.length) await exchangeRateService.ensureRatesFor(ratePairs);
    if (request !== previewRequest.current) return;
    const result = withDateRejections(
      await repository.importCsv(parsed, false),
      unreadable,
    );
    if (request !== previewRequest.current) return;
    // Rows and preview are written together, so the armed rows are always the ones previewed.
    dateRejections.current = unreadable;
    setRows(parsed);
    setPreview(result);
  };

  const commit = async () => {
    if (busyRef.current) return;
    setBusyFlag(true);
    try {
      const result = withDateRejections(
        await repository.importCsv(rows, true),
        dateRejections.current,
      );
      hapticSuccess();
      setPreview(result);
      showError(
        "Import complete",
        `${result.committedIds.length} ${result.committedIds.length === 1 ? "transaction" : "transactions"} imported.`,
        { quiet: true },
      );
    } catch (reason) {
      showError(
        "Couldn’t import CSV",
        errorMessage(reason, "No rows were imported."),
      );
    } finally {
      setBusyFlag(false);
    }
  };

  const exportData = async () => {
    // Ref-guarded: a second tap while the share sheet or file write is still running must not
    // start another export.
    if (exportingRef.current) return;
    exportingRef.current = true;
    setExporting(true);
    try {
      const csv = repository.exportCsv();
      const filename = `qashy-transactions-${todayLocal()}.csv`;
      requireHandedOff(
        await saveFile(
          filename,
          "text/csv;charset=utf-8",
          csv,
          t("Export Qashy transactions"),
        ),
      );
    } catch (reason) {
      showError("Couldn’t export CSV", errorMessage(reason, "Try again."));
    } finally {
      exportingRef.current = false;
      setExporting(false);
    }
  };

  return {
    state,
    t,
    sourceRows,
    headers,
    headerLabels,
    mapping,
    setMapping,
    dateChoice,
    setDateChoice,
    detectedDateFormat,
    signDecidesType,
    defaultAccountId,
    setDefaultAccountId,
    defaultCategoryId,
    setDefaultCategoryId,
    preview,
    busy,
    invalidatePreview,
    exporting,
    isOptionalField,
    missingRequiredFields,
    pick,
    previewImport,
    commit,
    exportData,
  };
}
