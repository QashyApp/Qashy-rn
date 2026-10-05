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

type Step = "menu" | "category" | "date";

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
  busy: boolean;
  onChangeCategory: (categoryId: string | null) => void;
  onChangeDate: (localDate: string) => void;
  onClose: () => void;
}) {
  const theme = useQashyTheme();
  const { radius, space } = theme;
  const m3 = theme.materialControls;
  const { t } = useLocalization();
  const [step, setStep] = useState<Step>("menu");
  const [date, setDate] = useState(initialDate);

  const close = () => {
    setStep("menu");
    onClose();
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
      onRequestClose={step === "menu" ? close : () => setStep("menu")}
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
                onPress={() => setStep("menu")}
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
