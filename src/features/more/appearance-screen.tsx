import { useState } from 'react';
import { ScrollView, View, useColorScheme } from 'react-native';

import { AnimatedMoney } from '@/components/finance/animated-money';
import { ActionButton } from '@/components/ui/action-button';
import { AppIcon } from '@/components/ui/app-icon';
import { AppText } from '@/components/ui/app-text';
import { Card } from '@/components/ui/card';
import { ChoiceChip } from '@/components/ui/choice-chip';
import { ColorSwatch } from '@/components/ui/color-swatch';
import { FormField } from '@/components/ui/form-field';
import { MotionView } from '@/components/ui/motion';
import { ProgressBar } from '@/components/ui/progress-bar';
import { SegmentedControl, type SegmentOption } from '@/components/ui/segmented-control';
import type { AccentSource, ThemeMode } from '@/domain/models';
import { useLocalization } from '@/localization/localization';
import { useFinanceRepository, useFinanceState } from '@/providers/finance-provider';
import { previewAccentTokens, useQashyTheme } from '@/theme/theme';
import { ACCENT_PRESETS, mixHex, radius, space } from '@/theme/tokens';
import { errorMessage, showError } from '@/utils/confirm';

const THEME_MODE_ICONS: Record<ThemeMode, string> = { system: 'circle.lefthalf.filled', light: 'sun.max', dark: 'moon' };
const THEME_MODE_OPTIONS: SegmentOption<ThemeMode>[] = [
  { value: 'system', label: 'System', icon: THEME_MODE_ICONS.system },
  { value: 'light', label: 'Light', icon: THEME_MODE_ICONS.light },
  { value: 'dark', label: 'Dark', icon: THEME_MODE_ICONS.dark },
];
/** A representative amount for the live preview hero — never a real balance. */
const PREVIEW_NET_WORTH_MINOR = 1284350;

export function AppearanceScreen() {
  const repository = useFinanceRepository();
  const { settings } = useFinanceState();
  const theme = useQashyTheme();
  const { t } = useLocalization();
  const systemScheme = useColorScheme();
  const [expectedRevision, setExpectedRevision] = useState(settings.revision);
  const [mode, setMode] = useState<ThemeMode>(settings.themeMode);
  const [source, setSource] = useState<AccentSource>(settings.accentSource);
  const [hex, setHex] = useState(settings.accentHex);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const validHex = /^#[0-9A-Fa-f]{6}$/.test(hex);
  const previewMode = mode === 'system' ? (systemScheme === 'dark' ? 'dark' : 'light') : mode;
  const preview = previewAccentTokens(source, validHex ? hex : theme.staticAccent, previewMode === 'dark');
  // Android's Material You accent is a dynamic platform color, so it cannot be
  // blended in JS the way a hex accent can. Fade the secondary lines instead.
  const dynamicAccent = typeof preview.accent !== 'string' || typeof preview.onAccent !== 'string';
  const previewMuted = dynamicAccent
    ? preview.onAccent
    : mixHex(preview.onAccent as string, preview.accent as string, 0.25);
  const previewMutedStyle = { color: previewMuted, opacity: dynamicAccent ? 0.75 : 1 };
  const customError = source === 'custom' && !validHex
    ? 'Use a six-digit hex color such as #5966E9.'
    : undefined;
  const save = async () => {
    if (saving || customError) return;
    setSaving(true);
    setSaved(false);
    try {
      const updated = await repository.updateSettings({
        themeMode: mode,
        accentSource: source,
        accentHex: validHex ? hex.toUpperCase() : settings.accentHex,
      }, expectedRevision);
      setExpectedRevision(updated.revision);
      setSaved(true);
    } catch (reason) {
      showError('Couldn’t save appearance', errorMessage(reason, 'Try again.'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" style={{ flex: 1, backgroundColor: theme.background }} contentContainerStyle={{ padding: 18, paddingBottom: 40, gap: 16, width: '100%', maxWidth: 720, alignSelf: 'center' }}>
      {/* Live preview: a mini hero built from the pending (unsaved) mode/accent, not the applied
          theme. `ActionButton` and `ProgressBar` always render off the applied `useQashyTheme()`
          context, so the button below is a hand-styled stand-in that mirrors its look using
          `preview.accent`/`preview.onAccent` directly — it is not interactive and never becomes
          real chrome, it exists purely so a color choice reads instantly, before Save. */}
      <MotionView key={`${mode}-${source}-${hex}`} variant="fade" exit animateLayout>
        <Card style={{ backgroundColor: preview.accent, gap: space.lg }}>
          <View style={{ gap: space.xxs }}>
            <AppText variant="overline" style={previewMutedStyle}>Preview · Net worth</AppText>
            <AnimatedMoney
              minor={PREVIEW_NET_WORTH_MINOR}
              currency={settings.baseCurrency}
              locale={settings.locale}
              variant="display"
              style={{ color: preview.onAccent }}
            />
          </View>
          <ProgressBar value={0.64} label={t('Preview progress')} color={preview.onAccent} />
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              alignSelf: 'flex-start',
              minHeight: 40,
              paddingHorizontal: space.lg,
              borderRadius: radius.pill,
              flexDirection: 'row',
              alignItems: 'center',
              gap: space.sm,
              backgroundColor: preview.onAccent,
            }}>
            <AppIcon name="checkmark" color={preview.accent} size={16} />
            <AppText selectable={false} variant="label" style={{ color: preview.accent }}>Looks good</AppText>
          </View>
        </Card>
      </MotionView>
      <MotionView>
        <Card style={{ gap: 16 }}>
          <AppText variant="headline">Appearance</AppText>
          <SegmentedControl label="Appearance" options={THEME_MODE_OPTIONS} value={mode} onChange={(value) => { setMode(value); setSaved(false); }} />
        </Card>
      </MotionView>
      <MotionView>
        <Card style={{ gap: 16 }}>
          <AppText variant="headline">Accent source</AppText>
          <View accessibilityLabel={t('Accent source')} accessibilityRole="radiogroup" style={{ gap: 12 }}>
            <ChoiceChip label={process.env.EXPO_OS === 'android' ? 'Material You wallpaper' : 'Qashy default'} selected={source === 'system'} onPress={() => { setSource('system'); setSaved(false); }} icon="paintbrush" />
            <AppText muted>{process.env.EXPO_OS === 'android' ? 'Android 12 and later derive this from your wallpaper. Older versions use Qashy’s default palette.' : 'Uses Qashy’s indigo accent on neutral surfaces.'}</AppText>
            <AppText variant="label">Curated accents</AppText>
            {/* A raised well around the swatches, so the selected one (pressed-in via its own
                checkmark + border) reads as sitting inside a carved tray rather than floating
                loose on the card. `ColorSwatch` itself is untouched. */}
            <Card variant="inset">
              <View style={{ flexDirection: 'row', gap: 12, flexWrap: 'wrap' }}>
                {ACCENT_PRESETS.map((color) => <ColorSwatch key={color} color={color} selected={source === 'preset' && hex.toUpperCase() === color} label={`Use ${color} accent`} onPress={() => { setSource('preset'); setHex(color); setSaved(false); }} />)}
              </View>
            </Card>
          </View>
          <FormField label="Custom accent" value={hex} onChangeText={(value) => { setSource('custom'); setHex(value); setSaved(false); }} autoCapitalize="characters" maxLength={7} error={customError} hint="Only the accent changes. Qashy gently adjusts unsafe colors to preserve contrast." />
        </Card>
      </MotionView>
      <MotionView>
        <ActionButton title={saving ? 'Saving…' : saved ? 'Saved' : 'Save appearance'} icon="checkmark" size="large" disabled={saving || Boolean(customError)} busy={saving} onPress={save} />
      </MotionView>
    </ScrollView>
  );
}
