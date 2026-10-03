import {
  Host,
  SegmentedButton,
  SingleChoiceSegmentedButtonRow,
  Text,
} from "@expo/ui/jetpack-compose";
import { fillMaxWidth, semantics } from "@expo/ui/jetpack-compose/modifiers";

import {
  JsSegmentedControl,
  type SegmentOption,
} from "@/components/ui/js-segmented-control";
import { useLocalization } from "@/localization/localization";
import { useQashyTheme } from "@/theme/theme";
import { hapticSelection } from "@/utils/haptics";

export type { SegmentOption };

/**
 * One choice out of a few, shown all at once. On the flat (Material 3) engine this is the real
 * Jetpack Compose `SingleChoiceSegmentedButtonRow`, so it has the system's own check, ripple and
 * TalkBack behavior; the `Host` seeds Compose's palette from the app accent. Every other theme
 * keeps the sliding-thumb pill.
 *
 * Use it for 2–5 short, mutually exclusive options that change a view (a filter, a chart mode,
 * a theme). Longer or open-ended lists belong in `ChoiceListField`.
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "regular",
  lockLtr = false,
}: {
  /** Accessible name for the group. */
  label: string;
  options: readonly SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: "regular" | "compact";
  /** Keep the control left-to-right whatever the UI language (the language selector). */
  lockLtr?: boolean;
}) {
  const theme = useQashyTheme();
  const { t, isRtl } = useLocalization();
  if (!theme.materialControls) {
    return (
      <JsSegmentedControl
        label={label}
        options={options}
        value={value}
        onChange={onChange}
        size={size}
        lockLtr={lockLtr}
      />
    );
  }

  const rtl = lockLtr ? false : isRtl;
  const accent = theme.accent;
  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme={theme.mode}
      seedColor={typeof accent === "string" ? accent : undefined}
      layoutDirection={rtl ? "rightToLeft" : "leftToRight"}
      style={{ alignSelf: "stretch" }}
    >
      <SingleChoiceSegmentedButtonRow
        modifiers={[
          fillMaxWidth(),
          semantics({ contentDescription: t(label) }),
        ]}
      >
        {options.map((option) => (
          <SegmentedButton
            key={option.value}
            selected={option.value === value}
            onClick={() => {
              if (option.value === value) return;
              hapticSelection();
              onChange(option.value);
            }}
          >
            <SegmentedButton.Label>
              <Text>{option.literal ? option.label : t(option.label)}</Text>
            </SegmentedButton.Label>
          </SegmentedButton>
        ))}
      </SingleChoiceSegmentedButtonRow>
    </Host>
  );
}
