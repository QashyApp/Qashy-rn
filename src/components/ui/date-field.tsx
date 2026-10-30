import { DateTimePicker } from "@expo/ui/community/datetime-picker";
import { useState } from "react";
import { Pressable, View } from "react-native";

import {
  dateRangeHint,
  formatFieldDate,
  type DateFieldProps,
} from "@/components/ui/date-field-format";
import { FormField } from "@/components/ui/form-field";
import { IconButton } from "@/components/ui/icon-button";
import { useLocalization } from "@/localization/localization";
import { useQashyTheme } from "@/theme/theme";
import { isLocalDate, parseLocalDate, todayLocal } from "@/utils/date";
import { hapticSelection } from "@/services/haptics";

const pad = (value: number) => String(value).padStart(2, "0");

/**
 * Android's Material date picker works in UTC calendar days: it takes and returns the UTC
 * midnight of the chosen day. Feeding it a local time, or reading its result with local
 * getters, moves the date by one for everyone west of Greenwich.
 */
function toPickerDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function fromPickerDate(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/**
 * A date chosen from the platform's own calendar instead of typed as `YYYY-MM-DD`.
 *
 * The field looks like every other form field and opens the picker when pressed: a Material
 * dialog on Android. Picking a day closes it.
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
  // The date an out-of-range pick was rejected for. The message is derived from it rather than
  // stored: it follows the bounds and the locale, and it stops applying as soon as the bounds make
  // the rejected pick valid. A change of the value drops it too (adjusted during render, from the
  // previous value), so it cannot return if the value later goes back to what it was.
  const [rejected, setRejected] = useState<string | null>(null);
  const [seenValue, setSeenValue] = useState(value);
  if (seenValue !== value) {
    setSeenValue(value);
    setRejected(null);
  }
  // A stored value that is not a calendar date (a bad import, an old draft) must not take the
  // form down: it reads as empty here, and the picker starts from today instead.
  const usable = isLocalDate(value) ? value : "";
  const display = usable ? formatFieldDate(usable, locale) : "";
  const translatedLabel = t(label);
  const rangeError = rejected
    ? dateRangeHint(rejected, locale, minimumDate, maximumDate)
    : null;
  const shownError = error ?? rangeError ?? undefined;

  const pick = (date: Date) => {
    setOpen(false);
    const next = fromPickerDate(date);
    // The dialog keeps to the bounds itself; this covers an engine that does not.
    const outside = dateRangeHint(next, locale, minimumDate, maximumDate);
    if (outside) {
      setRejected(next);
      return;
    }
    setRejected(null);
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
            shownError
              ? t(shownError)
              : hint
                ? t(hint)
                : t("Opens a date picker.")
          }
          onPress={() => setOpen(true)}
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
              dimWhenLocked={false}
              error={shownError}
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
              setRejected(null);
              onChange("");
            }}
          />
        ) : null}
      </View>
      {open ? (
        <DateTimePicker
          value={toPickerDate(usable || todayLocal())}
          mode="date"
          display="default"
          presentation="dialog"
          accentColor={String(theme.accent)}
          themeVariant={theme.mode}
          // Bounds are read through the local calendar, unlike the value.
          minimumDate={minimumDate ? parseLocalDate(minimumDate) : undefined}
          maximumDate={maximumDate ? parseLocalDate(maximumDate) : undefined}
          onValueChange={(_event, date) => pick(date)}
          onDismiss={() => setOpen(false)}
        />
      ) : null}
    </View>
  );
}
