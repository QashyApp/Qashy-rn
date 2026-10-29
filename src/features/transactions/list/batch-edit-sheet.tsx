import { useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { ActionButton } from "@/components/ui/action-button";
import { AppText } from "@/components/ui/app-text";
import { ChoiceChip } from "@/components/ui/choice-chip";
import { DateField } from "@/components/ui/date-field";
import { IconButton } from "@/components/ui/icon-button";
import { MotionView } from "@/components/ui/motion";
import { SettingsRow } from "@/components/ui/settings-row";
import type { Category } from "@/domain/models";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";

export type BatchEditStep = "menu" | "category" | "date";
type Step = BatchEditStep;

/**
 * What can be done to a selection besides deleting it, behind the batch bar's "Edit" button:
 * move the transactions to another category, or to another date. The bar itself stays one
 * compact row; the choices live here.
 */
export function BatchEditSheet({
  visible,
  count,
  categories,
  categoryBlockedReason,
  initialDate,
  initialStep,
  busy,
  onChangeCategory,
  onChangeDate,
  onClose,
}: {
  visible: boolean;
  count: number;
  /** Categories every selected transaction can take. Empty when `categoryBlockedReason` is set. */
  categories: readonly Category[];
  /** Why the selection cannot change category (transfers, or income mixed with expenses). */
  categoryBlockedReason: string | null;
  /** Where the date picker starts: the selection's own date when they all share one. */
  initialDate: string;
  /**
   * Opens straight at this step instead of the menu (a single row's swipe action opens at
   * "category"). Back from that step then closes the sheet, since there is no menu to go back to.
   */
  initialStep?: Step;
  busy: boolean;
  onChangeCategory: (categoryId: string | null) => void;
  onChangeDate: (localDate: string) => void;
  onClose: () => void;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const m3 = theme.materialControls;
  const { t } = useLocalization();
  const rootStep: Step = initialStep ?? "menu";
  const [step, setStep] = useState<Step>(rootStep);
  const [date, setDate] = useState(initialDate);

  // A sheet that stays mounted while hidden must reopen at its starting step.
  const [wasVisible, setWasVisible] = useState(visible);
  if (visible !== wasVisible) {
    setWasVisible(visible);
    if (visible) {
      setStep(rootStep);
      setDate(initialDate);
    }
  }

  const close = () => {
    setStep(rootStep);
    onClose();
  };
  const back = () => {
    if (rootStep === "menu") setStep("menu");
    else close();
  };
  const open = (next: Step) => {
    if (next === "date") setDate(initialDate);
    setStep(next);
  };

  return (
    <Modal
      animationType="fade"
      transparent
      visible={visible}
      onRequestClose={step === "menu" ? close : back}
    >
      <SafeAreaView
        edges={["top", "right", "bottom", "left"]}
        style={{ flex: 1, justifyContent: "flex-end", padding: space.lg }}
      >
        <Pressable
          accessibilityLabel={t("Close")}
          accessibilityRole="button"
          onPress={close}
          style={{
            position: "absolute",
            inset: 0,
            backgroundColor: theme.scrim,
          }}
        />
        <MotionView
          accessibilityViewIsModal
          importantForAccessibility="yes"
          variant="up"
          style={[
            {
              width: "100%",
              maxWidth: 520,
              maxHeight: "80%",
              alignSelf: "center",
              padding: space.lg,
              gap: space.md,
              borderRadius: m3 ? radius.sheet : radius.card,
              borderCurve: "continuous",
            },
            m3
              ? { backgroundColor: theme.surfaceMuted }
              : materialStyle(theme, "overlay"),
          ]}
        >
          <View
            style={{
              minHeight: 44,
              flexDirection: "row",
              alignItems: "center",
              gap: space.sm,
            }}
          >
            {step === "menu" ? null : (
              <IconButton
                label="Back"
                icon="chevron.left"
                mirrorIcon
                onPress={back}
              />
            )}
            <AppText literal variant="headline" style={{ flex: 1 }}>
              {t(
                step === "category"
                  ? "Change category"
                  : step === "date"
                    ? "Change date"
                    : count === 1
                      ? "Edit 1 transaction"
                      : `Edit ${count} transactions`,
              )}
            </AppText>
            <IconButton label="Close" icon="xmark" onPress={close} />
          </View>

          {step === "menu" ? (
            <View style={{ gap: space.xs }}>
              <SettingsRow
                title="Change category"
                subtitle={categoryBlockedReason ?? undefined}
                icon="ion:pricetag-outline"
                disabled={Boolean(categoryBlockedReason) || busy}
                onPress={() => open("category")}
              />
              <SettingsRow
                title="Change date"
                icon="calendar"
                disabled={busy}
                onPress={() => open("date")}
              />
            </View>
          ) : step === "category" ? (
            <ScrollView
              contentContainerStyle={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: space.sm,
              }}
            >
              <ChoiceChip
                mode="button"
                icon="questionmark.circle"
                label="Uncategorized"
                selected={false}
                disabled={busy}
                onPress={() => onChangeCategory(null)}
              />
              {categories.map((category) => (
                <ChoiceChip
                  mode="button"
                  key={category.id}
                  literal
                  icon={category.icon}
                  label={category.name}
                  selected={false}
                  disabled={busy}
                  onPress={() => onChangeCategory(category.id)}
                />
              ))}
            </ScrollView>
          ) : (
            <View style={{ gap: space.md }}>
              <DateField
                label="Date"
                value={date}
                onChange={setDate}
                required
              />
              <ActionButton
                title={
                  count === 1
                    ? "Move 1 transaction"
                    : `Move ${count} transactions`
                }
                icon="calendar"
                disabled={busy || !date}
                busy={busy}
                onPress={() => onChangeDate(date)}
              />
            </View>
          )}
        </MotionView>
      </SafeAreaView>
    </Modal>
  );
}
