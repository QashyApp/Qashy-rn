import { useEffect, useId, useRef, useState } from "react";
import { View } from "react-native";

import { AppText } from "@/components/ui/app-text";
import type { DateFieldProps } from "@/components/ui/date-field-format";
import { IconButton } from "@/components/ui/icon-button";
import { MotionView } from "@/components/ui/motion";
import { useLocalization } from "@/localization/localization";
import { materialStyle } from "@/theme/materials";
import { useQashyTheme } from "@/theme/theme";
import { fontStyle } from "@/theme/typography";
import { isLocalDate } from "@/utils/date";

/**
 * The browser's own date control: a calendar popup on every engine, and keyboard entry in the
 * locale's own order, which a typed `YYYY-MM-DD` field never was. Its value is always ISO, so
 * forms keep validating the same string.
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
  const { radius, space } = theme;
  const { isRtl, t } = useLocalization();
  const [focused, setFocused] = useState(false);
  const descriptionId = useId();
  const description = error ?? hint;
  const sunken = materialStyle(theme, "sunken");
  const font = fontStyle("regular", theme.type);
  // Uncontrolled: mid-entry a date input reports "" while it still shows the typed parts, and
  // React restoring a controlled value would wipe them. The prop is pushed in only when it
  // really changes (a clear, a reset, another field moving it).
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = inputRef.current;
    if (input && input.value !== value) input.value = value;
  }, [value]);

  return (
    <View style={{ gap: space.sm - 1 }}>
      <AppText variant="label">
        {label}
        {required ? " *" : ""}
      </AppText>
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space.xs }}
      >
        <input
          type="date"
          // Named like every other form field, which adds "required" for assistive tech.
          aria-label={required ? `${t(label)}, ${t("required")}` : t(label)}
          aria-required={required || undefined}
          aria-invalid={Boolean(error)}
          aria-describedby={description ? descriptionId : undefined}
          ref={inputRef}
          defaultValue={value}
          min={minimumDate}
          max={maximumDate}
          required={required}
          onChange={(event) => {
            const input = event.currentTarget;
            const next = input.value;
            // A half-typed date reads as "" (with `badInput`) until it is complete; only pass on
            // whole dates or a deliberate clear.
            if (isLocalDate(next) || (next === "" && !input.validity.badInput))
              onChange(next);
          }}
          onClick={(event) => {
            // Open the calendar from anywhere in the field, not only the small icon.
            const input = event.currentTarget as HTMLInputElement & {
              showPicker?: () => void;
            };
            try {
              input.showPicker?.();
            } catch {
              // Not allowed without a user gesture in some engines; the field still types.
            }
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={{
            flex: 1,
            minWidth: 0,
            minHeight: 48,
            boxSizing: "border-box",
            paddingInline: space.lg - 2,
            paddingBlock: space.md,
            borderRadius: radius.tile,
            borderWidth: 2,
            borderStyle: "solid",
            borderColor: error
              ? String(theme.negative)
              : focused
                ? String(theme.accent)
                : "transparent",
            outline: "none",
            backgroundColor: String(sunken.backgroundColor),
            boxShadow: sunken.boxShadow ? String(sunken.boxShadow) : undefined,
            color: String(theme.text),
            fontSize: 16,
            fontFamily: font.fontFamily,
            direction: isRtl ? "rtl" : "ltr",
            // The calendar icon and popup follow the theme instead of the OS.
            colorScheme: theme.mode,
            cursor: "pointer",
          }}
        />
        {optional && value ? (
          <IconButton
            label="Clear date"
            icon="xmark"
            onPress={() => onChange("")}
          />
        ) : null}
      </View>
      {description ? (
        <MotionView key={description} variant="up" exit animateLayout>
          <AppText
            nativeID={descriptionId}
            accessibilityRole={error ? "alert" : undefined}
            accessibilityLiveRegion={error ? "polite" : undefined}
            variant="caption"
            muted={!error}
            style={error ? { color: theme.negative } : undefined}
          >
            {description}
          </AppText>
        </MotionView>
      ) : null}
    </View>
  );
}
