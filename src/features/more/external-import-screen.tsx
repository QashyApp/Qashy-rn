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

import { View } from "react-native";

import { ActionButton } from "@/components/ui/action-button";
import { AppIcon } from "@/components/ui/app-icon";
import { AppText } from "@/components/ui/app-text";
import { Card } from "@/components/ui/card";
import { FormScreen } from "@/components/ui/form-screen";
import { MotionView } from "@/components/ui/motion";
import { OptionRow } from "@/components/ui/option-row";
import { ProgressBar } from "@/components/ui/progress-bar";
import { TextButton } from "@/components/ui/text-button";
import { IMPORT_SOURCES } from "@/data/import/sources";
import { type ImportMode } from "@/data/import/types";
import { useQashyTheme } from "@/theme/theme";
import {
  SourceDetails,
  describeCounts,
} from "@/features/more/external-import/import-summary-parts";
import { PreviewVerdict } from "@/features/more/external-import/preview-verdict";
import { PreviewDetails } from "@/features/more/external-import/preview-details";
import { STAGES } from "@/features/more/external-import/external-import-model";
import { useExternalImport } from "@/features/more/external-import/use-external-import";

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

export function ExternalImportScreen() {
  const theme = useQashyTheme();
  const { space } = theme;
  const {
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
  } = useExternalImport();

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
              mirrorIcon
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
                mirrorIcon
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
