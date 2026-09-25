import { View } from 'react-native';

import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { ColorSwatch } from '@/components/ui/color-swatch';
import { MotionPressable, MotionView } from '@/components/ui/motion';
import { SegmentedControl } from '@/components/ui/segmented-control';
import type { AccentSource, ThemeMode } from '@/domain/models';
import { StepHeading } from '@/features/onboarding/onboarding-shell';
import { useLocalization } from '@/localization/localization';
import { useQashyTheme } from '@/theme/theme';
import { ACCENT_PRESET_NAMES, ACCENT_PRESETS, radius, space, tile } from '@/theme/tokens';
import { formatMoney } from '@/utils/money';

const THEMES = [
  { value: 'system', label: 'System', icon: 'circle.lefthalf.filled' },
  { value: 'light', label: 'Light', icon: 'sun.max' },
  { value: 'dark', label: 'Dark', icon: 'moon' },
] as const;

/**
 * Appearance. Every choice applies to the whole app immediately (the flow
 * writes it to settings as a preview), and the small ledger card shows what
 * that looks like on real UI rather than on a swatch alone.
 */
export function LookStep({
  themeMode,
  accentSource,
  accentHex,
  currency,
  locale,
  onThemeMode,
  onAccent,
}: {
  themeMode: ThemeMode;
  accentSource: AccentSource;
  accentHex: string;
  currency: string;
  locale: string;
  onThemeMode: (mode: ThemeMode) => void;
  onAccent: (source: AccentSource, hex?: string) => void;
}) {
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const systemSelected = accentSource === 'system';

  return (
    <View style={{ gap: space.xxl }}>
      <StepHeading title="Make it yours" body="Pick a look. You can change it any time in More → Appearance." />

      <Preview currency={currency} locale={locale} />

      <View style={{ gap: space.lg }}>
        <SegmentedControl label="Appearance" options={THEMES} value={themeMode} onChange={onThemeMode} />
        <View accessibilityRole="radiogroup" accessibilityLabel={t('Accent color')} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.md, justifyContent: 'center' }}>
          {/* The system accent (Material You on Android, Qashy indigo elsewhere)
              sits in the same grid as the presets: it is one more choice of
              color, not a separate mode above them. */}
          <MotionPressable
            accessibilityRole="radio"
            accessibilityLabel={t('System accent')}
            accessibilityState={{ checked: systemSelected }}
            aria-checked={systemSelected}
            active={systemSelected}
            onPress={() => onAccent('system')}
            pressedScale={0.9}
            hoverScale={1.06}
            style={{
              width: 48,
              height: 48,
              borderRadius: radius.pill,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: theme.surface,
              borderWidth: systemSelected ? 3 : 1,
              borderColor: systemSelected ? theme.accent : theme.border,
            }}>
            <AppIcon name={systemSelected ? 'checkmark' : 'paintbrush'} color={systemSelected ? theme.accent : theme.textMuted} size={20} />
          </MotionPressable>
          {ACCENT_PRESETS.map((color) => (
            <ColorSwatch
              key={color}
              color={color}
              selected={!systemSelected && accentHex.toUpperCase() === color}
              label={t(ACCENT_PRESET_NAMES[color])}
              onPress={() => onAccent('preset', color)}
            />
          ))}
        </View>
      </View>
    </View>
  );
}

function Preview({ currency, locale }: { currency: string; locale: string }) {
  const theme = useQashyTheme();
  let amount = '';
  let balance = '';
  try {
    amount = formatMoney(-1250, currency, locale);
    balance = formatMoney(248_000, currency, locale);
  } catch {
    // Formatting only fails on an invalid currency, which the previous step rejects.
  }
  return (
    <Card accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={{ gap: space.lg, padding: space.xl }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <View style={{ gap: space.xxs }}>
          <AppText variant="caption" muted>Net worth</AppText>
          <AppText literal variant="money" numeric>{balance}</AppText>
        </View>
        <MotionView key={String(theme.accent)} variant="zoom" style={{ paddingHorizontal: space.md, paddingVertical: space.xs, borderRadius: radius.pill, backgroundColor: theme.accent }}>
          <AppText variant="caption" style={{ color: theme.onAccent, fontWeight: '600' }}>Add</AppText>
        </MotionView>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
        <View style={{ width: tile.size, height: tile.size, borderRadius: radius.tile, backgroundColor: theme.accentContainer, alignItems: 'center', justifyContent: 'center' }}>
          <AppIcon name="cart" color={theme.onAccentContainer} size={tile.icon} />
        </View>
        <View style={{ flex: 1, gap: space.xxs }}>
          <AppText variant="label">Groceries</AppText>
          <View style={{ height: 4, borderRadius: radius.pill, backgroundColor: theme.surfaceMuted, overflow: 'hidden' }}>
            <View style={{ width: '62%', height: '100%', backgroundColor: theme.accent }} />
          </View>
        </View>
        <AppText literal variant="label" numeric>{amount}</AppText>
      </View>
    </Card>
  );
}
