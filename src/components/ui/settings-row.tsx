import { View, type ColorValue } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { MotionPressable } from '@/components/ui/motion';
import { useLocalization } from '@/localization/localization';
import { useQashyTheme } from '@/theme/theme';
import { radius, space, toneColors, tile as tileMetrics } from '@/theme/tokens';

export function SettingsRow({
  title,
  subtitle,
  icon,
  color,
  value,
  tone = 'default',
  disabled = false,
  literal = false,
  selected,
  onPress,
}: {
  title: string;
  subtitle?: string;
  icon: string;
  color?: string;
  value?: string;
  tone?: 'default' | 'danger';
  disabled?: boolean;
  /**
   * Set when the row describes a stored entity (account, category, schedule,
   * rate) rather than fixed UI copy. Title, subtitle, and value are then
   * rendered and announced verbatim. Translate any fixed fragment at the call
   * site before composing it in.
   */
  literal?: boolean;
  /** When defined the row is in a multi-select list: a check marker replaces the chevron. */
  selected?: boolean;
  onPress?: () => void;
}) {
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const destructive = tone === 'danger';
  // Without this the row exposes title, subtitle, and value as three unrelated
  // leaves, so a screen reader never ties the value to what it belongs to.
  const accessibilityLabel = [title, subtitle, value]
    .filter((part): part is string => Boolean(part))
    .map((part) => (literal ? part : t(part)))
    .join(', ');
  // Same reasoning as the transaction row: an entity's color identifies it, it
  // does not rank it. A full-saturation tile in a list of thirty settings rows
  // reads as thirty alerts, so the seed is tinted toward the surface and the
  // glyph carries the contrast.
  const tile: { container: ColorValue; onContainer: ColorValue } = color
    ? toneColors(color, theme.staticSurface, theme.staticText, theme.mode === 'dark')
    : destructive
      ? { container: theme.surfaceMuted, onContainer: theme.negative }
      : { container: theme.accentContainer, onContainer: theme.accent };
  return (
    <MotionPressable
      accessibilityLabel={accessibilityLabel}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityState={onPress ? (selected === undefined ? { disabled } : { disabled, selected }) : undefined}
      onPress={onPress}
      disabled={!onPress || disabled}
      pressedScale={0.985}
      style={({ pressed }) => ({ minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: space.md, opacity: disabled ? 0.5 : pressed ? 0.62 : 1 })}>
      <View
        style={{
          width: tileMetrics.size,
          height: tileMetrics.size,
          borderRadius: radius.tile,
          borderCurve: 'continuous',
          backgroundColor: tile.container,
          alignItems: 'center',
          justifyContent: 'center',
          // A raised icon tile: a 1px top highlight catching the light, same
          // idea as a card's inner highlight but scaled to a small filled
          // square. Lighter in dark mode, where a bright highlight against a
          // dark tint would otherwise overpower the icon.
          boxShadow: `inset 0 1px 0 rgba(255,255,255,${theme.mode === 'dark' ? 0.06 : 0.35})`,
        }}>
        <AppIcon name={icon} color={tile.onContainer} size={tileMetrics.icon} />
      </View>
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        style={{ flex: 1, gap: space.xxs }}><AppText literal={literal} variant="label" style={destructive ? { color: theme.negative } : undefined}>{title}</AppText>{subtitle ? <AppText literal={literal} variant="caption" muted numberOfLines={2}>{subtitle}</AppText> : null}</View>
      {value ? (
        <AppText
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          literal={literal}
          variant="caption"
          muted
          numberOfLines={1}
          style={{ flexShrink: 1 }}>
          {value}
        </AppText>
      ) : null}
      {selected !== undefined ? (
        <View
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
          style={{
            width: 24,
            height: 24,
            borderRadius: 12,
            alignItems: 'center',
            justifyContent: 'center',
            borderWidth: 2,
            borderColor: selected ? theme.accent : theme.textMuted,
            backgroundColor: selected ? theme.accent : 'transparent',
          }}>
          {selected ? <AppIcon name="checkmark" color={theme.staticSurface} size={14} /> : null}
        </View>
      ) : onPress ? <AppIcon name="chevron.right" color={theme.textMuted} size={17} /> : null}
    </MotionPressable>
  );
}
