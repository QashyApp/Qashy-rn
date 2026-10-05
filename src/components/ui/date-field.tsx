import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { useState } from "react";
import { Pressable, View } from "react-native";

import {
  formatFieldDate,
  type DateFieldProps,
} from "@/components/ui/date-field-format";
import { FormField } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { useLocalization } from "@/localization/localization";
import { useQashyTheme } from "@/theme/theme";
import { parseLocalDate, todayLocal } from "@/utils/date";
import { hapticSelection } from "@/utils/haptics";

const IOS = process.env.EXPO_OS === "ios";

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Android's Material date picker works in UTC calendar days: it takes and returns the UTC
 * midnight of the chosen day. Feeding it a local time, or reading its result with local
 * getters, moves the date by one for everyone west of Greenwich. iOS takes and returns a
 * local date, so it gets local noon, which no DST change can push into another day.
 */
function toPickerDate(value: string) {
  if (IOS) return parseLocalDate(value);
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromPickerDate(date: Date) {
  return IOS
    ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
    : `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * A date chosen from the platform's own calendar instead of typed as `YYYY-MM-DD`.
 *
 * The field looks like every other form field and opens the picker when pressed: a Material
 * dialog on Android, and an inline calendar under the field on iOS (pressing the field again
 * folds it away). Picking a day closes it.
 */
export function DateField({
  label,
  value,
  onChange,
  error,
  hint,
  required = false,
  optional = false,
  minimumDate,
  maximumDate,
}: DateFieldProps) {
  const theme = useQashyTheme();
  const { space } = theme;
  const { locale, t } = useLocalization();
  const [open, setOpen] = useState(false);
  const display = value ? formatFieldDate(value, locale) : "";
  const translatedLabel = t(label);

  const pick = (date: Date) => {
    setOpen(false);
    const next = fromPickerDate(date);
    if (next !== value) {
      hapticSelection();
      onChange(next);
    }
  };

  return (
    <View style={{ gap: space.sm }}>
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={
            required ? `${translatedLabel}, ${t("required")}` : translatedLabel
          }
          accessibilityValue={{ text: display || t("Not set") }}
          accessibilityHint={
            error ? t(error) : hint ? t(hint) : t("Opens a date picker.")
          }
          accessibilityState={{ expanded: IOS ? open : undefined }}
          onPress={() => setOpen((current) => (IOS ? !current : true))}
          style={{ flex: 1 }}
        >
          {/* Shown, not focusable: the press opens the picker and the button above speaks for it. */}
          <View
            pointerEvents="none"
            importantForAccessibility="no-hide-descendants"
            accessibilityElementsHidden
          >
            <FormField
              label={label}
              value={display}
              placeholder="Choose a date"
              editable={false}
              error={error}
              hint={hint}
              required={required}
            />
          </View>
        </Pressable>
        {optional && value ? (
          <IconButton
            label="Clear date"
            icon="xmark"
            onPress={() => {
              setOpen(false);
              onChange("");
            }}
          />
        ) : null}
      </View>
      {open ? (
        <DateTimePicker
          value={toPickerDate(value || todayLocal())}
          mode="date"
          display={IOS ? "inline" : "default"}
          presentation="dialog"
          accentColor={String(theme.accent)}
          themeVariant={theme.mode}
          locale={IOS ? locale.replace("-", "_") : undefined}
          // Bounds are read through the local calendar on both platforms, unlike the value.
          minimumDate={minimumDate ? parseLocalDate(minimumDate) : undefined}
          maximumDate={maximumDate ? parseLocalDate(maximumDate) : undefined}
          onValueChange={(_event, date) => pick(date)}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </View>
  );
}
