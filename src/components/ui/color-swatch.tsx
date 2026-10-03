import { AppIcon } from '@/components/ui/app-icon';
import { MotionPressable, MotionView } from '@/components/ui/motion';
import { useLocalization } from '@/localization/localization';
import { ACCENT_PRESET_NAMES, readableTextColor } from '@/theme/tokens';
import { hapticSelection } from '@/utils/haptics';

/** A coarse, human name for a hex color, so screen readers never announce raw hex digits. */
export function describeColor(hex: string) {
  // The shipped presets have their own names, so two of them never announce the same word
  // (Indigo and Blue both fall in the coarse "Blue" hue band below).
  const preset = ACCENT_PRESET_NAMES[hex.trim().toUpperCase() as keyof typeof ACCENT_PRESET_NAMES];
  if (preset) return preset;
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return 'Custom color';
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(match[1].slice(offset, offset + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;
  const lightness = (max + min) / 2;
  if (delta < 0.08) return lightness > 0.85 ? 'White' : lightness < 0.2 ? 'Black' : 'Gray';
  let hue = max === r ? ((g - b) / delta) % 6 : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  hue = (hue * 60 + 360) % 360;
  if (hue < 15 || hue >= 345) return 'Red';
  if (hue < 40) return 'Orange';
  if (hue < 65) return 'Yellow';
  if (hue < 165) return 'Green';
  if (hue < 200) return 'Teal';
  if (hue < 250) return 'Blue';
  if (hue < 285) return 'Purple';
  return 'Pink';
}

export function ColorSwatch({
  color,
  selected,
  onPress,
}: {
  color: string;
  selected: boolean;
  /** Ignored: the announced name is derived from the color itself. Kept so existing callers still type-check. */
  label?: string;
  onPress: () => void;
}) {
  const { t } = useLocalization();
  return (
    <MotionPressable
      accessibilityLabel={t(describeColor(color))}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      aria-checked={selected}
      active={selected}
      onPress={() => {
        hapticSelection();
        onPress();
      }}
      pressedScale={0.9}
      hoverScale={1.06}
      style={({ pressed }) => ({
        width: 48,
        height: 48,
        borderRadius: 999,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
        borderWidth: selected ? 3 : 2,
        borderColor: selected ? readableTextColor(color) : 'transparent',
        opacity: pressed ? 0.68 : 1,
      })}>
      {selected ? (
        <MotionView variant="zoom" exit>
          <AppIcon name="checkmark" color={readableTextColor(color)} size={20} />
        </MotionView>
      ) : null}
    </MotionPressable>
  );
}
