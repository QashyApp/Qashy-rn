import { Picker } from "@expo/ui";
import { View } from "react-native";

import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { StatusPill } from "@/components/ui/status-pill";
import { FormScreen } from "@/components/ui/form-screen";
import { useQashyTheme } from "@/theme/theme";
import { ExternalImportLauncher } from "@/features/more/external-import-launcher";
import { CSV_FIELDS } from "@/features/more/csv/csv-model";
import { CSV_DATE_FORMAT_LABELS } from "@/utils/csv-import-values";
import { accountTypeIcon } from "@/utils/labels";
import { CsvStepper, PreviewTile } from "@/features/more/csv/csv-parts";
import { useCsvImport } from "@/features/more/csv/use-csv-import";

export function CsvScreen() {
  const theme = useQashyTheme();
  const { space } = theme;
  const {
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
  } = useCsvImport();

  return (
    <FormScreen
      maxWidth={760}
      contentContainerStyle={{ gap: space.lg, paddingBottom: 40 }}
    >
      <Card style={{ gap: 14 }}>
        <AppText variant="headline">Export transactions</AppText>
        <AppText muted>
          Creates a UTF-8 CSV of your transactions with accounts, categories,
          tags, notes and exchange rates. Not a full backup: budgets, goals and
          schedules are not included.
        </AppText>
        <ActionButton
          title="Export CSV"
          icon="tray"
          onPress={exportData}
          busy={exporting}
          disabled={exporting}
        />
      </Card>
      <ExternalImportLauncher />
      <Card style={{ gap: 14 }}>
        <AppText variant="headline">Import transactions</AppText>
        <CsvStepper
          current={
            preview?.committedIds.length
              ? 3
              : preview
                ? 2
                : sourceRows.length
                  ? 1
                  : 0
          }
        />
        <AppText muted>
          Headers are matched automatically. Required columns are date, title,
          amount, and account. Type and currency are optional and default to
          expense and your base currency. Nothing is committed until after
          preview.
        </AppText>
        <ActionButton
          title="Choose CSV"
          variant="secondary"
          onPress={pick}
          disabled={busy}
        />
        {sourceRows.length ? (
          <View style={{ gap: space.md, paddingTop: 6 }}>
            <AppText variant="headline">Column mapping</AppText>
            <AppText variant="caption" muted>
              Choose the source column for each Qashy field. Optional fields can
              stay Not mapped.
            </AppText>
            {CSV_FIELDS.map((field) => (
              <View
                key={field.key}
                accessibilityLabel={t(`Map ${field.label}`)}
                role="group"
                style={{
                  minHeight: 52,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: space.md,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.border,
                }}
              >
                <View style={{ flex: 1, gap: space.xxs }}>
                  <AppText variant="label">
                    {field.label}
                    {isOptionalField(field) ? "" : " *"}
                  </AppText>
                  {!isOptionalField(field) && !mapping[field.key] ? (
                    <AppText
                      accessibilityRole="alert"
                      variant="caption"
                      style={{ color: theme.negativeText }}
                    >
                      Required
                    </AppText>
                  ) : null}
                </View>
                <View
                  style={{
                    minWidth: 180,
                    minHeight: 44,
                    justifyContent: "center",
                  }}
                >
                  <Picker
                    selectedValue={mapping[field.key]}
                    onValueChange={(value) => {
                      setMapping((current) => ({
                        ...current,
                        [field.key]: String(value),
                      }));
                      invalidatePreview();
                    }}
                    enabled={!busy}
                    testID={`mapping-${field.key}`}
                  >
                    <Picker.Item label={t("Not mapped")} value="" />
                    {headers.map((header, index) => (
                      <Picker.Item
                        key={header}
                        label={headerLabels[index] || header}
                        value={header}
                      />
                    ))}
                  </Picker>
                </View>
              </View>
            ))}
            {mapping.date ? (
              <View
                accessibilityLabel={t("Date format")}
                role="group"
                style={{
                  minHeight: 52,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: space.md,
                  borderBottomWidth: 1,
                  borderBottomColor: theme.border,
                }}
              >
                <AppText variant="label" style={{ flex: 1 }}>
                  Date format
                </AppText>
                <View
                  style={{
                    minWidth: 180,
                    minHeight: 44,
                    justifyContent: "center",
                  }}
                >
                  <Picker
                    selectedValue={dateChoice}
                    onValueChange={(value) => {
                      setDateChoice(String(value) as typeof dateChoice);
                      invalidatePreview();
                    }}
                    enabled={!busy}
                    testID="date-format"
                  >
                    <Picker.Item
                      label={`${t("Auto")} (${CSV_DATE_FORMAT_LABELS[detectedDateFormat]})`}
                      value="auto"
                    />
                    <Picker.Item
                      label={CSV_DATE_FORMAT_LABELS.ymd}
                      value="ymd"
                    />
                    <Picker.Item
                      label={CSV_DATE_FORMAT_LABELS.dmy}
                      value="dmy"
                    />
                    <Picker.Item
                      label={CSV_DATE_FORMAT_LABELS.mdy}
                      value="mdy"
                    />
                  </Picker>
                </View>
              </View>
            ) : null}
            {signDecidesType ? (
              <AppText variant="caption" muted>
                Negative amounts import as expenses, positive as income.
              </AppText>
            ) : null}
            <AppText variant="label">Default account</AppText>
            <View
              accessibilityLabel={t("Default account")}
              accessibilityRole="radiogroup"
              style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}
            >
              {state.accounts
                .filter((item) => !item.archived)
                .map((account) => (
                  <ChoiceChip
                    key={account.id}
                    literal
                    icon={accountTypeIcon(account.type)}
                    label={account.name}
                    selected={defaultAccountId === account.id}
                    onPress={() => {
                      setDefaultAccountId(account.id);
                      invalidatePreview();
                    }}
                  />
                ))}
            </View>
            <AppText variant="label">Default category</AppText>
            <View
              accessibilityLabel={t("Default category")}
              accessibilityRole="radiogroup"
              style={{ flexDirection: "row", gap: space.sm, flexWrap: "wrap" }}
            >
              <ChoiceChip
                icon="xmark.circle"
                label="None"
                selected={!defaultCategoryId}
                onPress={() => {
                  setDefaultCategoryId("");
                  invalidatePreview();
                }}
              />
              {state.categories
                .filter((item) => !item.archived)
                .map((category) => (
                  <ChoiceChip
                    key={category.id}
                    literal
                    icon={category.icon}
                    label={category.name}
                    selected={defaultCategoryId === category.id}
                    onPress={() => {
                      setDefaultCategoryId(category.id);
                      invalidatePreview();
                    }}
                  />
                ))}
            </View>
            <AppText variant="caption" muted>
              The default category is used only for rows with the same
              transaction type. Other rows stay uncategorized.
            </AppText>
            {missingRequiredFields.length ? (
              <AppText
                accessibilityRole="alert"
                variant="caption"
                style={{ color: theme.negativeText }}
              >
                {`Map required fields: ${missingRequiredFields.map((field) => field.label).join(", ")}.`}
              </AppText>
            ) : null}
            <ActionButton
              title="Preview import"
              icon="checkmark"
              onPress={previewImport}
              disabled={busy || Boolean(missingRequiredFields.length)}
            />
          </View>
        ) : null}
        {preview ? (
          <View style={{ gap: 10, paddingTop: 6 }}>
            <View style={{ flexDirection: "row", gap: 10, flexWrap: "wrap" }}>
              <PreviewTile
                value={preview.validRows.length}
                label="Ready"
                tone="accent"
              />
              <PreviewTile
                value={preview.duplicateRows.length}
                label="Duplicates"
              />
              <PreviewTile
                value={preview.rejectedRows.length}
                label="Rejected"
                tone={preview.rejectedRows.length ? "negative" : "plain"}
              />
            </View>
            {preview.rejectedRows.length ? (
              <Card variant="list" dividerInset={0}>
                {/* Built as one string: the dictionary matches "Row N: reason" as a
                    whole and copies the reason through untouched. Split children
                    would translate the reason on its own. */}
                {preview.rejectedRows.slice(0, 20).map((row) => (
                  <View
                    key={row.rowNumber}
                    style={{ minHeight: 44, justifyContent: "center" }}
                  >
                    <StatusPill
                      literal
                      label={t(`Row ${row.rowNumber}: ${row.reason}`)}
                      icon="exclamationmark.triangle"
                      tone="negative"
                    />
                  </View>
                ))}
                {preview.rejectedRows.length > 20 ? (
                  <View
                    style={{
                      minHeight: 44,
                      justifyContent: "center",
                      paddingHorizontal: space.md,
                    }}
                  >
                    <AppText literal variant="caption" muted>
                      {t(
                        `+${preview.rejectedRows.length - 20} more rejected ${preview.rejectedRows.length - 20 === 1 ? "row" : "rows"}`,
                      )}
                    </AppText>
                  </View>
                ) : null}
              </Card>
            ) : null}
            {preview.validRows.length && !preview.committedIds.length ? (
              <ActionButton
                title={
                  busy
                    ? "Importing…"
                    : `Import ${preview.validRows.length} ${preview.validRows.length === 1 ? "transaction" : "transactions"}`
                }
                icon="checkmark"
                size="large"
                onPress={commit}
                disabled={busy}
              />
            ) : null}
          </View>
        ) : null}
      </Card>
    </FormScreen>
  );
}
