import { Host, Slider } from "@expo/ui/jetpack-compose";
import { fillMaxWidth, semantics } from "@expo/ui/jetpack-compose/modifiers";
import { useEffect, useRef, useState } from "react";

import { useLocalization } from "@/localization/localization";
import { useQashyTheme } from "@/theme/theme";
import { hapticSelection } from "@/services/haptics";

import {
  snapTransparency,
  type WidgetTransparencySliderProps,
} from "@/features/more/widget-transparency";

/**
 * The widget transparency control: the real Jetpack Compose Material 3 slider, 0–100 in steps of 5.
 * The thumb follows the finger through local state, and the value is saved once, when the finger
 * lifts, so a drag is one settings write (and one widget refresh), not dozens.
 */
export function WidgetTransparencySlider({
  label,
  value,
  onCommit,
}: WidgetTransparencySliderProps) {
  const theme = useQashyTheme();
  const { t, isRtl } = useLocalization();
  const accent = theme.accent;
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  // The saved value is the source of truth between drags: follow it when it changes under us.
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  const draftRef = useRef(value);
  const valueRef = useRef(value);
  useEffect(() => {
    draftRef.current = value;
    valueRef.current = value;
  }, [value]);
  const resetToStored = () => {
    draftRef.current = valueRef.current;
    setDraft(valueRef.current);
  };

  return (
    <Host
      matchContents={{ vertical: true }}
      colorScheme={theme.mode}
      seedColor={typeof accent === "string" ? accent : undefined}
      layoutDirection={isRtl ? "rightToLeft" : "leftToRight"}
      style={{ alignSelf: "stretch" }}
    >
      <Slider
        value={draft}
        min={0}
        max={100}
        // 21 positions (0, 5, ... 100): `steps` counts the stops between the two ends.
        steps={19}
        onValueChange={(next) => {
          const snapped = snapTransparency(next);
          if (snapped === draftRef.current) return;
          draftRef.current = snapped;
          hapticSelection();
          setDraft(snapped);
        }}
        onValueChangeFinished={() => {
          const committed = draftRef.current;
          if (committed === value) return;
          // A failed write leaves the stored value unchanged, so `value` never changes to pull the
          // thumb back: reset the draft to it here instead of showing a value that was not saved.
          void onCommit(committed).then((saved) => {
            if (!saved) resetToStored();
          }, resetToStored);
        }}
        modifiers={[
          fillMaxWidth(),
          semantics({ contentDescription: t(label) }),
        ]}
      />
    </Host>
  );
}
